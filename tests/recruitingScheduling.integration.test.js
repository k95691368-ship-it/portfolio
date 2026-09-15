import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { onRequestGet as slots, onRequestPost as addSlot, onRequestDelete as withdraw } from '../server/api/rooms/[roomId]/interview-slots.js'
import { onRequestPost as book, onRequestGet as listInterviews } from '../server/api/rooms/[roomId]/interviews/index.js'
import { onRequestPatch as change } from '../server/api/rooms/[roomId]/interviews/[sessionId]/index.js'
import { onRequestPost as join } from '../server/api/rooms/[roomId]/interviews/[sessionId]/join-token.js'
import { onRequestGet as reuse } from '../server/api/postings/[id]/reuse.js'
import { onRequestPost as publish } from '../server/api/postings/index.js'
import { onRequestPut as saveDraft } from '../server/api/posting-drafts/[id].js'
import { futureSlot, normalizeDuration } from '../server/_lib/interviewScheduling.js'

vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('No production database in tests') } }))
let pg, env
let savepoint = 0
const company = { id: 'company', role: 'company', is_recruiter: 1 }
const candidate = { id: 'candidate', role: 'candidate' }
const candidate2 = { id: 'candidate2', role: 'candidate' }
const start = offset => new Date(Date.now() + 86400000 + offset * 60000).toISOString()
function adapter(client) {
  return {
    async unsafe(query, values = []) { const result = await client.query(query, values); return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length }) },
    begin(operation) { return client.transaction(tx => operation(adapter(tx))) },
    async savepoint(operation) {
      const name = `test_batch_${++savepoint}`
      await client.query(`SAVEPOINT ${name}`)
      try { const result = await operation(adapter(client)); await client.query(`RELEASE SAVEPOINT ${name}`); return result }
      catch (error) { await client.query(`ROLLBACK TO SAVEPOINT ${name}`); await client.query(`RELEASE SAVEPOINT ${name}`); throw error }
    },
  }
}
const ctx = (user, body, roomId = 'room', sessionId, method = 'POST') => ({ env, data: { user }, params: { roomId, sessionId, id: 'posting' }, request: new Request('https://test.invalid/api', { method, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) }) })
const makeSlot = async (offset = 0, recordingRequired = true, user = company) => {
  const response = await addSlot(ctx(user, { startsAt: start(offset), durationMinutes: 30, recordingRequired }, user.id === 'stranger' ? 'foreign-room' : 'room'))
  expect(response.status, await response.clone().text()).toBe(201)
  return (await response.json()).id
}
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT);')
  for (const file of readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort()) await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  env = { DB: new PostgresD1(adapter(pg)) }
}, 30000)
beforeEach(async () => {
  await pg.exec(`TRUNCATE users CASCADE;
    INSERT INTO users (id,email,password_hash,password_salt,role,display_name,is_recruiter) VALUES
    ('company','company@example.invalid','unused','unused','company','담당자',1),
    ('candidate','candidate@example.invalid','unused','unused','candidate','지원자',0),
    ('candidate2','candidate2@example.invalid','unused','unused','candidate','지원자2',0),
    ('stranger','stranger@example.invalid','unused','unused','company','다른 담당자',1);
    INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code) VALUES
    ('room','company','면접','active','TESTROOM1234'),('room2','company','면접2','active','TESTROOM2345'),('foreign-room','stranger','다른 면접','active','TESTROOM3456');
    INSERT INTO room_participants (room_id,user_id,role_in_room) VALUES
    ('room','company','company'),('room','candidate','candidate'),('room2','company','company'),('room2','candidate2','candidate'),('foreign-room','stranger','company');
    INSERT INTO job_postings (id,created_by_user_id,title,description,deadline,wage_type,wage_min,work_hours_start,work_hours_end,work_days,status)
    VALUES ('posting','company','📋 모집','업무 내용','2000-01-01','hourly',15000,'09:00','18:00','월~금','closed');`)
})
afterAll(async () => { await pg?.close() })

it('registers, lists and reserves a slot using real PostgreSQL with forced employer recording policy', async () => {
  const id = await makeSlot()
  const available = await (await slots(ctx(candidate))).json()
  expect(available.slots[0]).toMatchObject({ id, available: true, durationMinutes: 30, recordingRequired: true })
  expect(JSON.stringify(available)).not.toContain('company_user_id')
  const response = await book(ctx(candidate, { slotId: id, recordingRequired: false, clientRequestId: 'retry' }))
  expect(response.status, await response.clone().text()).toBe(201)
  const { session } = await response.json()
  expect(session).toMatchObject({ bookingSlotId: id, recordingRequired: true, myRole: 'candidate', myConsentGranted: false, durationMinutes: 30 })
  expect((await (await slots(ctx(candidate2, {}, 'room2'))).json()).slots[0].available).toBe(false)
  expect((await book(ctx(candidate, { slotId: id, clientRequestId: 'retry' }))).status).toBe(200)
  const { rows } = await pg.query('SELECT * FROM interview_session_members')
  expect(rows).toHaveLength(2)
  expect(rows.find(row => row.user_id === company.id).role).toBe('host')
  const entrance = await join(ctx(candidate, {}, 'room', session.id))
  expect(entrance.status).toBe(403)
  expect((await entrance.json()).error).toContain('녹화에 동의')
})
it('serializes concurrent candidates: only one reservation wins', async () => {
  const id = await makeSlot()
  const results = await Promise.all([book(ctx(candidate, { slotId: id })), book(ctx(candidate2, { slotId: id }, 'room2'))])
  expect(results.map(response => response.status).sort()).toEqual([201,409])
  expect((await pg.query('SELECT id FROM interview_sessions')).rows).toHaveLength(1)
})
it('checks overlap against host-created interviews in other rooms, allowing adjacent times', async () => {
  const id = await makeSlot()
  const slot = (await (await slots(ctx(candidate))).json()).slots[0]
  expect((await book(ctx(company, { scheduledAt: slot.startsAt, durationMinutes: 30 }, 'room2'))).status).toBe(201)
  expect((await book(ctx(candidate, { slotId: id }))).status).toBe(409)
  const adjacent = new Date(Date.parse(slot.startsAt) + 30 * 60000).toISOString()
  expect((await book(ctx(company, { scheduledAt: adjacent, durationMinutes: 30 }))).status).toBe(201)
})
it('reschedules atomically and releases the old slot; conflicts leave the original booking intact', async () => {
  const first = await makeSlot(), second = await makeSlot(60), third = await makeSlot(120)
  const original = (await (await book(ctx(candidate, { slotId: first }))).json()).session
  await book(ctx(candidate2, { slotId: second }, 'room2'))
  expect((await change(ctx(candidate, { slotId: second }, 'room', original.id, 'PATCH'))).status).toBe(409)
  expect((await pg.query('SELECT booking_slot_id FROM interview_sessions WHERE id = $1', [original.id])).rows[0].booking_slot_id).toBe(first)
  const moved = await change(ctx(candidate, { slotId: third }, 'room', original.id, 'PATCH'))
  expect(moved.status, await moved.clone().text()).toBe(200)
  expect((await moved.json()).session.bookingSlotId).toBe(third)
  expect((await (await slots(ctx(candidate))).json()).slots.find(slot => slot.id === first).available).toBe(true)
})
it('cancels a candidate reservation, releases its slot, and returns the new active interview ahead of later cancelled ones', async () => {
  const later = await makeSlot(120), earlier = await makeSlot()
  const session = (await (await book(ctx(candidate, { slotId: later }))).json()).session
  const cancelled = await change(ctx(candidate, { status: 'cancelled' }, 'room', session.id, 'PATCH'))
  expect(cancelled.status, await cancelled.clone().text()).toBe(200)
  expect((await cancelled.json()).session.status).toBe('cancelled')
  expect((await book(ctx(candidate2, { slotId: later }, 'room2'))).status).toBe(201)
  const next = (await (await book(ctx(candidate, { slotId: earlier }))).json()).session
  expect((await (await listInterviews(ctx(candidate))).json()).latestSession.id).toBe(next.id)
})
it('does not allow changing recording policy or rescheduling after admission', async () => {
  const first = await makeSlot(), otherPolicy = await makeSlot(60, false), samePolicy = await makeSlot(120)
  const session = (await (await book(ctx(candidate, { slotId: first }))).json()).session
  expect((await change(ctx(candidate, { slotId: otherPolicy }, 'room', session.id, 'PATCH'))).status).toBe(409)
  expect((await change(ctx(candidate, { scheduledAt: start(90) }, 'room', session.id, 'PATCH'))).status).toBe(403)
  await pg.query("UPDATE interview_session_members SET admitted_at = datetime('now') WHERE session_id = $1 AND user_id = 'candidate'", [session.id])
  expect((await change(ctx(candidate, { slotId: samePolicy }, 'room', session.id, 'PATCH'))).status).toBe(409)
  expect((await change(ctx(candidate, { status: 'cancelled' }, 'room', session.id, 'PATCH'))).status).toBe(409)
})
it('enforces authorization, ownership, frozen rooms and withdrawn times', async () => {
  expect((await slots(ctx(null))).status).toBe(401)
  expect((await slots(ctx(candidate2))).status).toBe(403)
  expect((await addSlot(ctx(candidate, { startsAt: start(0) }))).status).toBe(403)
  const foreign = await makeSlot(0, true, { id: 'stranger', is_recruiter: 1 })
  expect((await book(ctx(candidate, { slotId: foreign }))).status).toBe(409)
  const id = await makeSlot()
  expect((await withdraw(ctx(company, { id }, 'room', null, 'DELETE'))).status).toBe(200)
  expect((await book(ctx(candidate, { slotId: id }))).status).toBe(409)
  const second = await makeSlot(60)
  await pg.exec("UPDATE interview_rooms SET archived_at = datetime('now') WHERE id = 'room'")
  expect((await book(ctx(candidate, { slotId: second }))).status).toBe(409)
})
it('rejects past/overlapping slots and protects a booked slot from withdrawal', async () => {
  expect((await addSlot(ctx(company, { startsAt: '2000-01-01T00:00:00Z', durationMinutes: 30, recordingRequired: true }))).status).toBe(400)
  const id = await makeSlot()
  expect((await addSlot(ctx(company, { startsAt: start(10), durationMinutes: 30, recordingRequired: true }))).status).toBe(409)
  await book(ctx(candidate, { slotId: id }))
  expect((await withdraw(ctx(company, { id }, 'room', null, 'DELETE'))).status).toBe(409)
})
it('reuses only the owner’s posting fields, clears the deadline, saves a separate draft and publishes a new ID', async () => {
  expect((await reuse(ctx(candidate))).status).toBe(403)
  expect((await reuse(ctx({ id: 'stranger', is_admin: 1 }))).status).toBe(404)
  const response = await reuse(ctx(company))
  expect(response.status).toBe(200)
  const { fields } = await response.json()
  expect(fields).toMatchObject({ title: '📋 모집', description: '업무 내용', wageMin: '15000', deadline: '', workHoursStart: '09:00' })
  expect(Object.keys(fields)).toHaveLength(12)
  const draftId = crypto.randomUUID()
  const draftCtx = ctx(company, { fields, revision: 0 }); draftCtx.params.id = draftId
  expect((await saveDraft(draftCtx)).status).toBe(200)
  expect((await publish(ctx(company, { ...fields, draftId, draftRevision: 1 }))).status).toBe(201)
  const { rows } = await pg.query('SELECT id, status, deadline FROM job_postings ORDER BY id')
  expect(rows).toHaveLength(2)
  expect(rows.find(row => row.id === 'posting')).toMatchObject({ status: 'closed', deadline: '2000-01-01' })
  expect((await pg.query('SELECT * FROM applications')).rows).toHaveLength(0)
})
it('validates duration and timezone and restricts the new table to the backend', async () => {
  expect(() => normalizeDuration('30')).toThrow()
  expect(() => futureSlot('2099-01-01T10:00:00')).toThrow()
  expect(() => futureSlot('2099-01-01T10:00:00Z')).toThrow()
  expect(() => futureSlot('2027-02-30T10:00:00Z', Date.parse('2027-01-01T00:00:00Z'))).toThrow()
  expect((await pg.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'interview_slots'")).rows[0].relrowsecurity).toBe(true)
  expect((await pg.query("SELECT has_table_privilege('anon','interview_slots','SELECT') AS allowed")).rows[0].allowed).toBe(false)
})

it('rolls back the entire booking when member creation fails, then permits a clean retry', async () => {
  const slotId = await makeSlot()
  await pg.exec(`CREATE FUNCTION fail_booking_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test insert failure'; END; $$;
    CREATE TRIGGER fail_booking_test BEFORE INSERT ON interview_session_members FOR EACH ROW EXECUTE FUNCTION fail_booking_test();`)
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    expect((await book(ctx(candidate, { slotId }))).status).toBe(500)
    expect((await pg.query('SELECT id FROM interview_sessions')).rows).toHaveLength(0)
    expect((await (await slots(ctx(candidate))).json()).slots[0].available).toBe(true)
  } finally {
    logger.mockRestore()
    await pg.exec('DROP TRIGGER fail_booking_test ON interview_session_members; DROP FUNCTION fail_booking_test();')
  }
  expect((await book(ctx(candidate, { slotId }))).status).toBe(201)
})
