import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Live database access prohibited') } }))
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { onRequestDelete as deleteDocument } from '../server/api/documents/[id]/index.js'
import { onRequestDelete as deleteUser } from '../server/api/admin/users/[id]/index.js'
import { onRequestDelete as deleteRoom } from '../server/api/admin/rooms/[roomId]/index.js'
import { processStorageCleanup } from '../server/_lib/storageCleanup.js'
import { onRequestPost as recoverRecording } from '../server/api/rooms/[roomId]/interviews/[sessionId]/recordings/[recordingId]/upload-ticket.js'

let pg, db, failure, ackTable
const migration = readFileSync('supabase/migrations/202609260001_storage_cleanup_intents.sql', 'utf8')
const owner = { id: 'owner', role: 'candidate' }
const admin = { id: 'admin', role: 'company', is_admin: 1 }

function adapter(client) {
  return {
    async unsafe(query, values = []) {
      if (failure?.(query)) throw new Error('Simulated DB failure')
      const result = await client.query(query, values)
      return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length })
    },
    async begin(operation) {
      let loseAck = false
      const value = await client.transaction(async transaction => {
        const wrapped = adapter(transaction), unsafe = wrapped.unsafe
        wrapped.unsafe = async (query, values) => {
          if (ackTable && new RegExp(`DELETE FROM ${ackTable}\\b`, 'i').test(query)) loseAck = true
          return unsafe(query, values)
        }
        return operation(wrapped)
      })
      if (loseAck) { ackTable = null; throw new Error('Lost transaction commit acknowledgement') }
      return value
    },
  }
}

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets (id TEXT PRIMARY KEY,name TEXT,public BOOLEAN,file_size_limit BIGINT);')
  for (const file of readdirSync('supabase/migrations').filter(name => name.endsWith('.sql') && name !== '202609130002_retention_schedule.sql').sort()) {
    await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  }
  db = new PostgresD1(adapter(pg))
}, 30000)
beforeEach(async () => {
  failure = null; ackTable = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('External access prohibited') })
  await pg.exec('TRUNCATE users CASCADE; TRUNCATE storage_cleanup_intents,contract_archive;')
  for (const user of [owner, admin]) await pg.query(`INSERT INTO users (id,email,password_hash,password_salt,role,display_name,is_admin)
    VALUES ($1,$2,'unused','unused',$3,$1,$4)`, [user.id, `${user.id}@example.invalid`, user.role, user.is_admin || 0])
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => { await pg?.close() })

async function fixture(kind = 'document') {
  const objects = new Set(), recordings = new Set(), observations = []
  const table = { document: 'documents', user: 'users', room: 'interview_rooms' }[kind]
  const id = kind === 'document' ? 'doc' : kind === 'user' ? 'owner' : 'room'
  const exists = async () => (await pg.query(`SELECT id FROM ${table} WHERE id = $1`, [id])).rows.length > 0
  const bucket = set => ({ delete: vi.fn(async key => { observations.push(await exists()); set.delete(key) }) })
  const env = { DB: db, DOCUMENTS: bucket(objects), INTERVIEW_RECORDINGS: bucket(recordings) }
  let invoke
  if (kind === 'room') {
    await pg.exec(`INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code) VALUES ('room','admin','Test','closed','CLEANUPPGROOM');
      INSERT INTO contract_terms (room_id,employer_name,employee_name) VALUES ('room','Company','Candidate');
      INSERT INTO interview_sessions (id,room_id,provider_meeting_id,title,status) VALUES ('session','room','meeting','Test','ended');
      INSERT INTO interview_recordings (id,session_id,status,storage_status,r2_key) VALUES ('recording','session','available','stored','recording.webm');
      INSERT INTO signed_contracts (id,room_id,r2_key,filename,size_bytes,stored_by_user_id) VALUES ('signed','room','contract.pdf','contract.pdf',10,'admin');`)
    objects.add('contract.pdf'); recordings.add('recording.webm')
    invoke = () => deleteRoom({ env, data: { user: admin }, params: { roomId: 'room' },
      request: new Request('https://test.invalid/api/admin/rooms/room', { method: 'DELETE', body: '{}' }) })
  } else {
    await pg.exec(`INSERT INTO documents (id,user_id,doc_type,filename,r2_key,size_bytes,content_type)
      VALUES ('doc','owner','resume','resume.pdf','original.pdf',10,'application/pdf')`)
    objects.add('original.pdf')
    invoke = () => kind === 'user'
      ? deleteUser({ env, data: { user: admin }, params: { id: 'owner' } })
      : deleteDocument({ env, data: { user: owner }, params: { id: 'doc' } })
  }
  const receipts = async () => (await pg.query('SELECT bucket,storage_key FROM storage_cleanup_intents ORDER BY bucket,storage_key')).rows
  const due = () => pg.exec("UPDATE storage_cleanup_intents SET not_before = datetime('now','-1 minute'), next_attempt_at = datetime('now','-1 minute')")
  return { env, table, objects, recordings, observations, exists, invoke, receipts, due }
}

it('applies the additive migration twice, retaining receipts and denying public role access', async () => {
  await pg.exec("INSERT INTO storage_cleanup_intents (bucket,storage_key,operation_id) VALUES ('documents','test.pdf','operation')")
  await pg.exec(migration)
  expect((await pg.query('SELECT storage_key FROM storage_cleanup_intents')).rows).toEqual([{ storage_key: 'test.pdf' }])
  expect((await pg.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'storage_cleanup_intents'::regclass")).rows[0].relrowsecurity).toBe(true)
  for (const role of ['anon', 'authenticated']) {
    expect((await pg.query("SELECT has_table_privilege($1,'storage_cleanup_intents','SELECT,INSERT,UPDATE,DELETE') AS allowed", [role])).rows[0].allowed).toBe(false)
  }
})

it.each(['UTC', 'Asia/Seoul', 'America/New_York'])('keeps UTC timestamp compatibility independent of the %s session timezone', async timezone => {
  const previous = (await pg.query('SHOW timezone')).rows[0].TimeZone
  try {
    await pg.query("SELECT set_config('TimeZone',$1,false)", [timezone])
    const { rows } = await pg.query(`SELECT
      datetime('2000-01-01 00:00:00') AS plain,
      datetime('2000-01-01 00:00:00','+1 hour') AS shifted,
      datetime('2000-01-01 00:00:00','+1 hour','-10 minutes') AS twice,
      datetime('2026-09-26T15:00:00+09:00') AS zoned,
      date('2000-01-01 00:00:00','-1 hour') AS day,
      julianday('2000-01-01 00:00:00') AS julian,
      datetime(datetime('now')) = datetime('now') AS roundtrip`)
    expect(rows[0]).toEqual({ plain: '2000-01-01 00:00:00', shifted: '2000-01-01 01:00:00',
      twice: '2000-01-01 00:50:00', zoned: '2026-09-26 06:00:00', day: '1999-12-31',
      julian: 2451544.5, roundtrip: true })
  } finally {
    await pg.query("SELECT set_config('TimeZone',$1,false)", [previous])
  }
})

it.each(['document', 'user', 'room'])('rolls back PostgreSQL %s deletion and its intent on DB failure', async kind => {
  const f = await fixture(kind)
  failure = query => new RegExp(`DELETE FROM ${f.table}\\b`, 'i').test(query)
  expect((await f.invoke()).status).toBe(503)
  expect(await f.exists()).toBe(true)
  expect(await f.receipts()).toHaveLength(0)
  expect(f.observations).toHaveLength(0)
  expect(f.objects.size).toBe(1)
})

it.each(['document', 'user', 'room'])('recovers PostgreSQL %s cleanup after a committed transaction loses its acknowledgement', async kind => {
  const f = await fixture(kind); ackTable = f.table
  expect((await f.invoke()).status).toBe(503)
  expect(await f.exists()).toBe(false)
  expect(await f.receipts()).toHaveLength(kind === 'room' ? 2 : 1)
  expect(f.observations).toHaveLength(0)
  await f.due()
  expect(await processStorageCleanup(f.env, { dryRun: false })).toMatchObject({ failed: 0, deleted: kind === 'room' ? 2 : 1 })
  expect(f.observations.every(present => !present)).toBe(true)
  expect(await f.receipts()).toHaveLength(0)
})

it.each(['document', 'user', 'room'])('persists PostgreSQL cleanup targets when %s storage is down and retries them', async kind => {
  const f = await fixture(kind)
  f.env.DOCUMENTS.delete.mockRejectedValueOnce(new Error('Storage unavailable'))
  const response = await f.invoke()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ cleanupPending: true })
  expect(await f.exists()).toBe(false)
  expect(await f.receipts()).toHaveLength(kind === 'room' ? 2 : 1)
  await f.due(); await processStorageCleanup(f.env, { dryRun: false })
  expect(await f.receipts()).toHaveLength(0)
  expect(f.objects.size + f.recordings.size).toBe(0)
})

it('keeps a permanent archive key protected after PostgreSQL room deletion', async () => {
  const f = await fixture('room')
  await pg.exec(`INSERT INTO contract_archive (id,room_id,terms_json,signatures_json,document_key,document_sha256,document_bytes)
    VALUES ('archive','room','{}','[]','contract.pdf','fixture',10)`)
  expect(await (await f.invoke()).json()).toMatchObject({ cleanupPending: true })
  expect(f.env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(f.objects.has('contract.pdf')).toBe(true)
  expect((await pg.query("SELECT source_deleted_at FROM contract_archive WHERE id = 'archive'")).rows[0].source_deleted_at).toBeTruthy()
})

it('blocks held and active recordings before queuing PostgreSQL room cleanup', async () => {
  const f = await fixture('room')
  await pg.exec("UPDATE interview_recordings SET retention_hold_reason = 'preserve'")
  expect((await f.invoke()).status).toBe(409)
  await pg.exec("UPDATE interview_recordings SET retention_hold_reason = NULL, status = 'processing'")
  expect((await f.invoke()).status).toBe(409)
  expect(await f.exists()).toBe(true)
  expect(await f.receipts()).toHaveLength(0)
  expect(f.observations).toHaveLength(0)
})

it('persists a 48-hour PostgreSQL recording retirement boundary and cleans a late upload afterwards', async () => {
  const f = await fixture('room')
  expect(await (await f.invoke()).json()).toMatchObject({ cleanupPending: true })
  expect(f.env.INTERVIEW_RECORDINGS.delete).not.toHaveBeenCalled()
  const receipt = (await pg.query(`SELECT storage_key,
    (not_before::timestamp - created_at::timestamp = interval '48 hours') AS waits
    FROM storage_cleanup_intents WHERE bucket = 'interview-recordings'`)).rows[0]
  expect(receipt).toEqual({ storage_key: 'recording.webm', waits: true })
  f.recordings.add('recording.webm')
  await processStorageCleanup(f.env, { dryRun: false })
  expect(f.env.INTERVIEW_RECORDINGS.delete).not.toHaveBeenCalled()
  expect(await f.receipts()).toHaveLength(1)
  await f.due(); await processStorageCleanup(f.env, { dryRun: false })
  expect(f.recordings.size).toBe(0)
  expect(await f.receipts()).toHaveLength(0)
})

it('uses PostgreSQL conditional claims so concurrent cleanup attempts issue one provider delete', async () => {
  const f = await fixture()
  f.env.DOCUMENTS.delete.mockRejectedValueOnce(new Error('Storage unavailable'))
  await f.invoke(); await f.due(); f.env.DOCUMENTS.delete.mockClear()
  await Promise.all(Array.from({ length: 5 }, () => processStorageCleanup(f.env, { dryRun: false })))
  expect(f.env.DOCUMENTS.delete).toHaveBeenCalledOnce()
  expect(await f.receipts()).toHaveLength(0)
})

async function recoveryContext(f) {
  await pg.exec(`INSERT INTO users (id,email,password_hash,password_salt,role,display_name)
    VALUES ('host','host@example.invalid','unused','unused','company','Host');
    UPDATE interview_rooms SET company_user_id = 'host';
    INSERT INTO room_participants (room_id,user_id,role_in_room) VALUES ('room','host','company');
    INSERT INTO interview_session_members (session_id,user_id,role,custom_participant_id) VALUES ('session','host','host','host-member');
    UPDATE interview_recordings SET created_by_user_id = 'host', status = 'failed', storage_status = 'pending',
      started_at = datetime('now'), retention_until = datetime('now','+1 day');`)
  f.env.INTERVIEW_RECORDINGS.createSignedUploadUrl = vi.fn(async key => ({ path: key, token: 'test-fixture' }))
  return { env: f.env, data: { user: { id: 'host', role: 'company' } },
    params: { roomId: 'room', sessionId: 'session', recordingId: 'recording' } }
}

it.each(['UTC', 'Asia/Seoul', 'America/New_York'].flatMap(timezone => [
  [timezone, 1], [timezone, 11],
]))('checks a %s deletion lock aged %i minutes before PostgreSQL recovery', async (timezone, minutes) => {
  const previous = (await pg.query('SHOW timezone')).rows[0].TimeZone
  try {
    await pg.query("SELECT set_config('TimeZone',$1,false)", [timezone])
    const f = await fixture('room'), context = await recoveryContext(f)
    await pg.query("INSERT INTO interview_room_deletion_locks (room_id,lock_token,created_at) VALUES ('room','delete',datetime('now',$1))", [`-${minutes} minutes`])
    expect((await recoverRecording(context)).status).toBe(minutes === 1 ? 409 : 200)
    expect(f.env.INTERVIEW_RECORDINGS.createSignedUploadUrl).toHaveBeenCalledTimes(minutes === 1 ? 0 : 1)
    expect((await pg.query("SELECT status FROM interview_recordings WHERE id = 'recording'")).rows[0].status)
      .toBe(minutes === 1 ? 'failed' : 'processing')
  } finally {
    await pg.query("SELECT set_config('TimeZone',$1,false)", [previous])
  }
})

it('blocks a late recovery with the PostgreSQL deletion lock before issuing an upload capability', async () => {
  const f = await fixture('room'), context = await recoveryContext(f), batch = db.batch.bind(db)
  let response
  vi.spyOn(db, 'batch').mockImplementation(async statements => {
    if (statements.some(statement => /DELETE FROM interview_rooms\b/.test(statement.source))) response = await recoverRecording(context)
    return batch(statements)
  })
  expect((await f.invoke()).status).toBe(200)
  expect(response.status).toBe(409)
  expect(f.env.INTERVIEW_RECORDINGS.createSignedUploadUrl).not.toHaveBeenCalled()
  expect(await f.exists()).toBe(false)
})

it('commits an earlier PostgreSQL recovery before URL issuance so deletion sees and preserves it', async () => {
  const f = await fixture('room'), context = await recoveryContext(f), observed = []
  f.env.INTERVIEW_RECORDINGS.createSignedUploadUrl.mockImplementation(async key => {
    observed.push((await pg.query("SELECT status FROM interview_recordings WHERE id = 'recording'")).rows[0].status)
    return { path: key, token: 'test-fixture' }
  })
  expect((await recoverRecording(context)).status).toBe(200)
  expect(observed).toEqual(['processing'])
  expect((await f.invoke()).status).toBe(409)
  expect(await f.exists()).toBe(true)
  expect(f.env.INTERVIEW_RECORDINGS.delete).not.toHaveBeenCalled()
  expect(await f.receipts()).toHaveLength(0)
})
