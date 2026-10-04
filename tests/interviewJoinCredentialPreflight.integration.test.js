import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { sqliteApp } from './helpers/sqliteApp.js'
import { CONSENT_NOTICE_HASH, CONSENT_NOTICE_VERSION } from '../server/_lib/interviews.js'
import { onRequestPost as addSlot, onRequestGet as listSlots } from '../server/api/rooms/[roomId]/interview-slots.js'
import { onRequestPost as book } from '../server/api/rooms/[roomId]/interviews/index.js'
import { onRequestPost as join } from '../server/api/rooms/[roomId]/interviews/[sessionId]/join-token.js'
import { onRequestGet as detail, onRequestPatch as change } from '../server/api/rooms/[roomId]/interviews/[sessionId]/index.js'
import { onRequestPost as signal } from '../server/api/rooms/[roomId]/interviews/[sessionId]/signaling.js'

vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Production database forbidden in tests') } }))

const isAdmissionWrite = query => /UPDATE interview_session_members\s+SET provider_participant_id =/i.test(query)

describe.each(['PostgreSQL', 'SQLite'])('%s credential preflight', engine => {
  let pg, db, env, fixture, savepoint, committed, lockBuckets, beforeAdmissionWrite, afterAdmissionWrite
  const host = { id: 'host', role: 'company', is_recruiter: 1 }
  const candidate = { id: 'candidate', role: 'candidate' }
  const outsider = { id: 'outsider', role: 'candidate' }

  function adapter(client) {
    return {
      async unsafe(query, values = []) {
        if (query.includes('pg_advisory_xact_lock')) lockBuckets.push(values[0])
        if (isAdmissionWrite(query)) await beforeAdmissionWrite?.(source => client.query(source))
        const result = await client.query(query, values)
        if (isAdmissionWrite(query)) await afterAdmissionWrite?.(source => client.query(source))
        return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length })
      },
      async begin(operation) {
        const result = await client.transaction(tx => operation(adapter(tx)))
        committed += 1
        return result
      },
      async savepoint(operation) {
        const name = `credential_fixture_${++savepoint}`
        await client.query(`SAVEPOINT ${name}`)
        try {
          const result = await operation(adapter(client))
          await client.query(`RELEASE SAVEPOINT ${name}`)
          return result
        } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${name}`)
          await client.query(`RELEASE SAVEPOINT ${name}`)
          throw error
        }
      },
    }
  }

  const context = (user = candidate, body = {}, method = 'POST') => ({
    env, data: { user }, params: { roomId: 'room', sessionId: fixture?.id },
    request: new Request('https://fixture.invalid/api', {
      method, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    }),
  })

  async function reserve(recordingRequired = false) {
    const startsAt = new Date(Date.now() + 86400000).toISOString()
    const first = await addSlot(context(host, { startsAt, durationMinutes: 30, recordingRequired }))
    expect(first.status).toBe(201)
    const slot = await first.json()
    const second = await addSlot(context(host, {
      startsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(), durationMinutes: 30, recordingRequired,
    }))
    expect(second.status).toBe(201)
    const other = await second.json()
    const response = await book(context(candidate, { slotId: slot.id }))
    expect(response.status).toBe(201)
    const { session } = await response.json()
    fixture = { id: session.id, firstSlot: slot.id, secondSlot: other.id }
  }

  const member = (user = candidate) => db.prepare(`SELECT provider_participant_id, provider_peer_id,
    admitted_at, joined_at, left_at, updated_at FROM interview_session_members WHERE session_id = ? AND user_id = ?`)
    .bind(fixture.id, user.id).first()
  const sessionRow = () => db.prepare('SELECT status, booking_slot_id FROM interview_sessions WHERE id = ?').bind(fixture.id).first()
  const admissionEvents = async () => (await db.prepare("SELECT id FROM interview_events WHERE session_id = ? AND event_type = 'participant.admitted'").bind(fixture.id).all()).results

  async function expectMemberUnchanged(previous, user = candidate) {
    const current = await member(user)
    for (const key of Object.keys(previous)) expect(current[key] === previous[key], `${key} preserved`).toBe(true)
  }

  async function expectConfigFailurePreserves(user = candidate) {
    const previous = await member(user)
    const previousSession = await sessionRow()
    const previousEvents = await admissionEvents()
    const previousCommits = committed
    const response = await join(context(user))
    expect(response.status).toBe(503)
    const payload = await response.json()
    expect(payload.error).toBe('화상 면접 서비스가 아직 설정되지 않았습니다.')
    expect(Boolean(payload.authToken || payload.participantId)).toBe(false)
    await expectMemberUnchanged(previous, user)
    expect(await sessionRow()).toEqual(previousSession)
    expect(await admissionEvents()).toEqual(previousEvents)
    if (engine === 'PostgreSQL') {
      // An HTTP error Response is still a fulfilled transaction, not a rollback.
      expect(committed).toBe(previousCommits + 1)
      expect(lockBuckets.at(-1)).toBe('interview-schedule:host')
    }
  }

  beforeAll(async () => {
    if (engine !== 'PostgreSQL') return
    pg = new PGlite()
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT);')
    for (const file of readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort()) {
      await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
    }
  }, 30000)

  beforeEach(async () => {
    savepoint = 0; committed = 0; lockBuckets = []; beforeAdmissionWrite = null; afterAdmissionWrite = null
    fixture = null
    if (engine === 'PostgreSQL') {
      await pg.exec('TRUNCATE users CASCADE')
      db = new PostgresD1(adapter(pg))
    } else {
      db = sqliteApp()
      // The shared SQLite fixture predates the PostgreSQL scheduling migration.
      // Mirror only its table/columns/indexes in this isolated in-memory database.
      db.sql.exec(`CREATE TABLE interview_slots (
        id TEXT PRIMARY KEY, company_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        starts_at TEXT NOT NULL, duration_minutes INTEGER NOT NULL CHECK (duration_minutes IN (15,30,45,60,90,120)),
        recording_required INTEGER NOT NULL DEFAULT 1 CHECK (recording_required IN (0,1)),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX interview_slots_company_time ON interview_slots(company_user_id, starts_at) WHERE active = 1;
      ALTER TABLE interview_sessions ADD COLUMN booking_slot_id TEXT REFERENCES interview_slots(id) ON DELETE SET NULL;
      ALTER TABLE interview_sessions ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes IN (15,30,45,60,90,120));
      CREATE UNIQUE INDEX interview_sessions_booked_slot ON interview_sessions(booking_slot_id)
        WHERE booking_slot_id IS NOT NULL AND status IN ('scheduled','waiting','live');`)
      const prepare = db.prepare
      db.prepare = source => {
        const statement = prepare(source)
        if (isAdmissionWrite(source)) {
          const run = statement.run
          statement.run = async () => {
            await beforeAdmissionWrite?.(query => db.sql.exec(query))
            const result = await run()
            await afterAdmissionWrite?.(query => db.sql.exec(query))
            return result
          }
        }
        return statement
      }
    }
    env = { DB: db }
    for (const user of [host, candidate, outsider]) {
      await db.prepare(`INSERT INTO users (id,email,password_hash,password_salt,role,display_name,is_recruiter)
        VALUES (?, ?, 'unused', 'unused', ?, ?, ?)`)
        .bind(user.id, `${user.id}@fixture.invalid`, user.role, user.id, user.is_recruiter ?? 0).run()
    }
    await db.prepare("INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code) VALUES ('room','host','Synthetic interview','active','SYNTHETICROOM')").run()
    await db.prepare("INSERT INTO room_participants (room_id,user_id,role_in_room) VALUES ('room','host','company'),('room','candidate','candidate')").run()
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External requests forbidden in tests') }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled()
    if (engine === 'SQLite') db.close()
    vi.restoreAllMocks(); vi.unstubAllGlobals()
  })
  afterAll(async () => { await pg?.close() })

  it.each(['local-unconfigured', 'hosted-public-key-missing'])('preserves an unadmitted booking on %s 503, including repeated attempts and fresh GET', async mode => {
    await reserve()
    if (mode === 'hosted-public-key-missing') {
      env.SUPABASE_URL = 'https://fixture.invalid'
      env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-server-only-key'
    }
    await expectConfigFailurePreserves()
    await expectConfigFailurePreserves()
    const response = await detail(context(candidate, {}, 'GET'))
    expect(response.status).toBe(200)
    const { session } = await response.json()
    expect(session.status).toBe('scheduled')
    expect(session.members.find(row => row.userId === candidate.id)).toMatchObject({ admittedAt: null, joinedAt: null })
  })

  it('keeps the candidate cancellation/released-slot alternative usable after a failed entrance', async () => {
    await reserve()
    await join(context(candidate))
    const cancelled = await change(context(candidate, { status: 'cancelled' }, 'PATCH'))
    expect(cancelled.status).toBe(200)
    expect((await sessionRow()).status).toBe('cancelled')
    const { slots } = await (await listSlots(context(candidate, {}, 'GET'))).json()
    expect(slots.find(row => row.id === fixture.firstSlot).available).toBe(true)
  })

  it('does not block candidate cancellation merely because the host credential preflight failed', async () => {
    await reserve()
    await expectConfigFailurePreserves(host)
    expect((await change(context(candidate, { status: 'cancelled' }, 'PATCH'))).status).toBe(200)
  })

  it('allows explicit retry after configuration is available without changing the successful admission policy', async () => {
    await reserve()
    await expectConfigFailurePreserves()
    env.SUPABASE_URL = 'https://fixture.invalid'
    env.SUPABASE_PUBLISHABLE_KEY = 'synthetic-public-key'
    const response = await join(context(candidate))
    expect(response.status).toBe(200)
    expect(Boolean((await response.json()).authToken)).toBe(true)
    expect((await sessionRow()).status).toBe('waiting')
    expect(await admissionEvents()).toHaveLength(1)
    expect((await change(context(candidate, { status: 'cancelled' }, 'PATCH'))).status).toBe(409)
  })

  it.each([['candidate', candidate], ['host', host]])('keeps %s rescheduling usable after failed credential preflight', async (_role, user) => {
    await reserve()
    await join(context(candidate))
    const response = await change(context(user, { slotId: fixture.secondSlot }, 'PATCH'))
    expect(response.status).toBe(200)
    expect((await sessionRow()).booking_slot_id).toBe(fixture.secondSlot)
    const { slots } = await (await listSlots(context(candidate, {}, 'GET'))).json()
    expect(slots.find(row => row.id === fixture.firstSlot).available).toBe(true)
  })

  it.each([['candidate', candidate], ['host', host]])('preserves every previous %s admission/provider/leave field on failed re-entry', async (_role, user) => {
    await reserve()
    await db.prepare(`UPDATE interview_session_members SET provider_participant_id = 'previous-participant',
      provider_peer_id = 'previous-peer', admitted_at = '2026-10-01 09:00:00', joined_at = '2026-10-01 09:01:00',
      left_at = '2026-10-01 09:02:00', updated_at = '2026-10-01 09:02:00' WHERE session_id = ? AND user_id = ?`)
      .bind(fixture.id, user.id).run()
    await db.prepare("UPDATE interview_sessions SET status = 'waiting' WHERE id = ?").bind(fixture.id).run()
    await expectConfigFailurePreserves(user)
  })

  it('does not invalidate a previously issued participant identity when a later re-entry has missing configuration', async () => {
    await reserve()
    env.SUPABASE_URL = 'https://fixture.invalid'
    env.SUPABASE_PUBLISHABLE_KEY = 'synthetic-public-key'
    const response = await join(context(candidate))
    expect(response.status).toBe(200)
    const { participantId } = await response.json()
    expect((await signal(context(candidate, { action: 'heartbeat', participantId }))).status).toBe(200)
    delete env.SUPABASE_PUBLISHABLE_KEY
    await expectConfigFailurePreserves()
    expect((await signal(context(candidate, { action: 'heartbeat', participantId }))).status).toBe(200)
  })

  it.each(['received', 'lost-response'])('keeps normal successful admission and scheduling locks when the response is %s', async delivery => {
    await reserve()
    env.SUPABASE_URL = 'https://fixture.invalid'
    env.SUPABASE_ANON_KEY = 'synthetic-public-key'
    const response = await join(context(candidate))
    expect(response.status).toBe(200)
    if (delivery === 'received') {
      const payload = await response.json()
      expect(Boolean(payload.authToken && payload.participantId)).toBe(true)
      expect(payload.roomId).toBe('room')
      expect(payload.sessionId).toBe(fixture.id)
      expect(payload.role).toBe('candidate')
    } else {
      // Deliberately discard the fulfilled response; no client-side receipt is required for admission.
      await response.body.cancel()
    }
    const registered = await member()
    expect(Boolean(registered.provider_participant_id && registered.admitted_at)).toBe(true)
    expect(registered.joined_at).toBe(null)
    expect((await sessionRow()).status).toBe('waiting')
    expect(await admissionEvents()).toHaveLength(1)
    expect((await change(context(candidate, { status: 'cancelled' }, 'PATCH'))).status).toBe(409)
    expect((await change(context(candidate, { slotId: fixture.secondSlot }, 'PATCH'))).status).toBe(409)
    expect((await change(context(host, { slotId: fixture.secondSlot }, 'PATCH'))).status).toBe(409)
    await expectMemberUnchanged(registered)
  })

  it.each(['missing', 'stale-hash', 'revoked'])('rejects %s required consent before missing-config handling without admission', async consent => {
    await reserve(true)
    if (consent !== 'missing') {
      await db.prepare(`INSERT INTO interview_recording_consents (session_id,user_id,notice_version,notice_hash,granted,revoked_at)
        VALUES (?, 'candidate', ?, ?, 1, ?)`)
        .bind(fixture.id, CONSENT_NOTICE_VERSION, consent === 'stale-hash' ? 'stale-fixture-hash' : CONSENT_NOTICE_HASH,
          consent === 'revoked' ? '2026-10-01 09:00:00' : null).run()
    }
    const previous = await member()
    const response = await join(context(candidate))
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('녹화에 동의')
    await expectMemberUnchanged(previous)
    expect(await admissionEvents()).toHaveLength(0)
  })

  it('preserves synthetic current consent and unadmitted state when credentials still cannot be issued', async () => {
    await reserve(true)
    await db.prepare(`INSERT INTO interview_recording_consents (session_id,user_id,notice_version,notice_hash,granted,consented_at)
      VALUES (?, 'candidate', ?, ?, 1, '2026-10-01 09:00:00')`).bind(fixture.id, CONSENT_NOTICE_VERSION, CONSENT_NOTICE_HASH).run()
    const readConsent = () => db.prepare('SELECT * FROM interview_recording_consents WHERE session_id = ?').bind(fixture.id).first()
    const previous = await readConsent()
    await expectConfigFailurePreserves()
    expect(await readConsent()).toEqual(previous)
  })

  it('rejects a suspended account before credential preflight without admission', async () => {
    await reserve()
    await db.prepare("UPDATE users SET is_suspended = 1 WHERE id = 'candidate'").run()
    const previous = await member()
    const response = await join(context(candidate))
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('계정이 비활성화')
    await expectMemberUnchanged(previous)
  })

  it.each([['unauthenticated', null, 401], ['nonmember', outsider, 403], ['admin', { ...outsider, is_admin: 1 }, 403]])(
    'rejects %s access without touching admission', async (_name, user, status) => {
      await reserve()
      const previous = await member()
      expect((await join(context(user))).status).toBe(status)
      await expectMemberUnchanged(previous)
      expect(await admissionEvents()).toHaveLength(0)
    }
  )

  it.each(['before-update', 'after-update'])('retains active-account guards at the synthetic %s admission boundary', async boundary => {
    await reserve()
    env.SUPABASE_URL = 'https://fixture.invalid'
    env.SUPABASE_PUBLISHABLE_KEY = 'synthetic-public-key'
    const suspend = execute => execute("UPDATE users SET is_suspended = 1 WHERE id = 'candidate'")
    if (boundary === 'before-update') beforeAdmissionWrite = suspend
    else afterAdmissionWrite = suspend
    const response = await join(context(candidate))
    expect(response.status).toBe(403)
    expect(Boolean((await response.json()).authToken)).toBe(false)
    expect((await member()).admitted_at).toBe(null)
    expect((await sessionRow()).status).toBe('scheduled')
    expect(await admissionEvents()).toHaveLength(0)
  })

  it.each(['before-update', 'after-update'])('retains current-consent guards at the synthetic %s admission boundary', async boundary => {
    await reserve(true)
    await db.prepare(`INSERT INTO interview_recording_consents (session_id,user_id,notice_version,notice_hash,granted)
      VALUES (?, 'candidate', ?, ?, 1)`).bind(fixture.id, CONSENT_NOTICE_VERSION, CONSENT_NOTICE_HASH).run()
    env.SUPABASE_URL = 'https://fixture.invalid'
    env.SUPABASE_PUBLISHABLE_KEY = 'synthetic-public-key'
    const revokeFixture = execute => execute("UPDATE interview_recording_consents SET granted = 0 WHERE user_id = 'candidate'")
    if (boundary === 'before-update') beforeAdmissionWrite = revokeFixture
    else afterAdmissionWrite = revokeFixture
    const response = await join(context(candidate))
    expect(response.status).toBe(403)
    expect(Boolean((await response.json()).authToken)).toBe(false)
    expect((await member()).admitted_at).toBe(null)
    expect((await sessionRow()).status).toBe('scheduled')
    expect(await admissionEvents()).toHaveLength(0)
  })
})
