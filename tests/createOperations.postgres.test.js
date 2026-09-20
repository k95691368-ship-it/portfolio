import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Live database access is forbidden') } }))
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { onRequestPost as createPosting } from '../server/api/postings/index.js'
import { onRequestPost as createRoom } from '../server/api/rooms/create.js'

let pg, db, failQuery, savepointSequence = 0
const statements = []
// Execute actual PostgreSQL SQL and the production adapter. PGlite serializes
// transactions on one connection; this is not a multi-connection load test.
function adapter(client) {
  return {
    async unsafe(query, values = []) {
      statements.push(query)
      if (failQuery?.(query)) throw new Error('Injected transaction failure')
      const result = await client.query(query, values)
      return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length })
    },
    begin(operation) { return client.transaction(transaction => operation(adapter(transaction))) },
    async savepoint(operation) {
      const name = `create_test_${++savepointSequence}`
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

const owner = { id: 'owner', role: 'company', is_recruiter: 1 }
const other = { id: 'other', role: 'company', is_recruiter: 1 }
const routes = [
  { kind: 'posting', handler: createPosting, table: 'job_postings', ownerColumn: 'created_by_user_id', body: { title: '공고', description: '정규화한 본문' } },
  { kind: 'room', handler: createRoom, table: 'interview_rooms', ownerColumn: 'company_user_id', body: { title: '면접방' } },
]
const call = (route, body, user = owner, database = db) => route.handler({
  env: { DB: database }, data: { user },
  request: new Request(`https://test.invalid/api/${route.kind}`, { method: 'POST', body: JSON.stringify(body) }),
})
const count = async table => Number((await pg.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n)

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT);')
  for (const name of ['202609030001_cloudflare_to_supabase.sql', '202609120002_posting_drafts.sql', '202609190004_create_operations.sql']) {
    await pg.exec(readFileSync(`supabase/migrations/${name}`, 'utf8'))
  }
  db = new PostgresD1(adapter(pg))
}, 30000)
beforeEach(async () => {
  failQuery = null
  statements.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await pg.exec('TRUNCATE users CASCADE')
  for (const user of [owner, other, { id: 'candidate', role: 'candidate' }]) {
    await pg.query(`INSERT INTO users (id, email, password_hash, password_salt, role, display_name)
      VALUES ($1, $2, 'unused', 'unused', $3, $1)`, [user.id, `${user.id}@example.invalid`, user.role])
  }
})
afterEach(() => { vi.restoreAllMocks(); failQuery = null })
afterAll(async () => { await pg?.close() })

it.each(routes)('$kind recovers a committed creation after its response is lost, including a new login session', async route => {
  const body = { ...route.body, operationId: crypto.randomUUID() }
  const lost = await call(route, body)
  expect(lost.status).toBe(201)
  // Deliberately do not consume the first response until the retry has finished.
  const retry = await call(route, body, { ...owner, session_id: 'new-login-session' })
  expect(retry.status).toBe(200)
  const replay = await retry.json()
  expect(replay).toMatchObject({ id: (await lost.json()).id, recovered: true })
  expect(await count(route.table)).toBe(1)
  expect(await count('create_operations')).toBe(1)
  if (route.kind === 'room') expect(await count('room_participants')).toBe(1)
  if (route.kind === 'posting') expect(await count('admin_audit_log')).toBe(1)
  expect(statements.some(query => query.includes('pg_advisory_xact_lock'))).toBe(true)
})

it.each(routes)('$kind serializes concurrent identical operations and returns one resource', async route => {
  const body = { ...route.body, operationId: crypto.randomUUID() }
  const responses = await Promise.all(Array.from({ length: 5 }, () => call(route, body)))
  expect(responses.map(response => response.status).sort()).toEqual([200, 200, 200, 200, 201])
  const ids = await Promise.all(responses.map(async response => (await response.json()).id))
  expect(new Set(ids).size).toBe(1)
  expect(await count(route.table)).toBe(1)
  expect(await count('create_operations')).toBe(1)
})

it.each(routes)('$kind rejects changed normalized payload for the same key without a second creation', async route => {
  const body = { ...route.body, operationId: crypto.randomUUID() }
  expect((await call(route, body)).status).toBe(201)
  expect((await call(route, { ...body, title: '다른 내용' })).status).toBe(409)
  // Input whitespace is normalized before hashing, and UUID case is canonical.
  expect((await call(route, { ...body, title: ` ${body.title} `, operationId: body.operationId.toUpperCase() })).status).toBe(200)
  expect(await count(route.table)).toBe(1)
})

it.each(routes)('$kind scopes keys to the authenticated owner, not the current session', async route => {
  const body = { ...route.body, operationId: crypto.randomUUID() }
  const first = await (await call(route, body)).json()
  const secondResponse = await call(route, body, other)
  expect(secondResponse.status).toBe(201)
  expect((await secondResponse.json()).id).not.toBe(first.id)
  expect(await count(route.table)).toBe(2)
  expect(await count('create_operations')).toBe(2)
})

it('scopes the same owner/key by operation kind', async () => {
  const operationId = crypto.randomUUID()
  for (const route of routes) expect((await call(route, { ...route.body, operationId })).status).toBe(201)
  expect(await count('create_operations')).toBe(2)
})

it.each(routes)('$kind never resurrects a deleted resource when its old request is retried', async route => {
  const body = { ...route.body, operationId: crypto.randomUUID() }
  const result = await (await call(route, body)).json()
  if (route.kind === 'room') await pg.query('DELETE FROM room_participants WHERE room_id = $1', [result.id])
  await pg.query(`DELETE FROM ${route.table} WHERE id = $1`, [result.id])
  expect((await call(route, body)).status).toBe(410)
  expect(await count(route.table)).toBe(0)
  expect(await count('create_operations')).toBe(1)
})

it.each(routes)('$kind rechecks current permission and resource ownership on replay', async route => {
  const body = { ...route.body, operationId: crypto.randomUUID() }
  const result = await (await call(route, body)).json()
  expect((await call(route, body, null)).status).toBe(401)
  expect((await call(route, body, { id: owner.id, role: 'candidate' })).status).toBe(403)
  await pg.query(`UPDATE ${route.table} SET ${route.ownerColumn} = $1 WHERE id = $2`, [other.id, result.id])
  expect((await call(route, body)).status).toBe(403)
  expect(await count(route.table)).toBe(1)
})

it.each(routes)('$kind rolls back the resource and any children if receipt insertion fails', async route => {
  const body = { ...route.body, operationId: crypto.randomUUID() }
  failQuery = query => query.includes('INSERT INTO create_operations')
  expect((await call(route, body)).status).toBe(503)
  expect(await count(route.table)).toBe(0)
  expect(await count('create_operations')).toBe(0)
  expect(await count('room_participants')).toBe(0)
  failQuery = null
  expect((await call(route, body)).status).toBe(201)
})

it('rolls back a room insert and leaves no receipt when participant creation returns an error response', async () => {
  const route = routes[1]
  const body = { ...route.body, operationId: crypto.randomUUID() }
  failQuery = query => query.includes('INSERT INTO room_participants')
  expect((await call(route, body)).status).toBe(500)
  expect(await count('interview_rooms')).toBe(0)
  expect(await count('room_participants')).toBe(0)
  expect(await count('create_operations')).toBe(0)
  failQuery = null
  expect((await call(route, body)).status).toBe(201)
})

it('recovers an actual PostgreSQL invite-code UNIQUE violation using a savepoint inside the operation transaction', async () => {
  await pg.query(`INSERT INTO interview_rooms (id, company_user_id, title, invite_code)
    VALUES ('existing-room', 'other', '기존 면접방', 'AAAAAAAAAAAA')`)
  vi.spyOn(crypto, 'getRandomValues')
    .mockImplementationOnce(bytes => bytes.fill(0))
    .mockImplementationOnce(bytes => bytes.fill(1))
  const route = routes[1]
  const body = { ...route.body, operationId: crypto.randomUUID() }
  const response = await call(route, body)
  expect(response.status).toBe(201)
  expect((await response.json()).inviteCode).toBe('BBBBBBBBBBBB')
  expect(await count('interview_rooms')).toBe(2)
  expect(await count('room_participants')).toBe(1)
  expect(await count('create_operations')).toBe(1)
})

it('returns current room title/status and invite code instead of retaining a response snapshot', async () => {
  const route = routes[1]
  const body = { ...route.body, operationId: crypto.randomUUID() }
  const result = await (await call(route, body)).json()
  await pg.query("UPDATE interview_rooms SET title = '수정됨', status = 'closed', invite_code = 'NEWCODE23456' WHERE id = $1", [result.id])
  expect(await (await call(route, body)).json()).toEqual({ id: result.id, title: '수정됨', status: 'closed', inviteCode: 'NEWCODE23456', recovered: true })
})

it.each([null, '', 'not-a-uuid', 12, {}, '00000000-0000-0000-0000-000000000000', '11111111-1111-4111-7111-111111111111'])('rejects invalid operation IDs before any creation: %j', async operationId => {
  for (const route of routes) expect((await call(route, { ...route.body, operationId })).status).toBe(400)
  expect(await count('interview_rooms')).toBe(0)
  expect(await count('job_postings')).toBe(0)
  expect(await count('create_operations')).toBe(0)
})

it.each(routes)('$kind fails closed without transaction support while preserving legacy requests', async route => {
  const legacyDb = { prepare: db.prepare.bind(db), batch: db.batch.bind(db) }
  expect((await call(route, { ...route.body, operationId: crypto.randomUUID() }, owner, legacyDb)).status).toBe(503)
  expect(await count(route.table)).toBe(0)
  expect((await call(route, route.body, owner, legacyDb)).status).toBe(201)
  expect(await count('create_operations')).toBe(0)
})

async function draftFor(user = owner) {
  const id = crypto.randomUUID()
  await pg.query(`INSERT INTO posting_drafts (id, user_id, title, payload, updated_at)
    VALUES ($1, $2, '임시저장', '{}', datetime('now'))`, [id, user.id])
  return id
}

it('publishes a revision-checked draft only once and recovers its original operation despite the consumed revision', async () => {
  const route = routes[0]
  const body = { ...route.body, operationId: crypto.randomUUID(), draftId: await draftFor(), draftRevision: 1 }
  const responses = await Promise.all([call(route, body), call(route, body)])
  expect(responses.map(response => response.status).sort()).toEqual([200, 201])
  const ids = await Promise.all(responses.map(async response => (await response.json()).id))
  expect(ids[0]).toBe(ids[1])
  expect((await pg.query('SELECT revision, published_posting_id FROM posting_drafts WHERE id = $1', [body.draftId])).rows[0])
    .toMatchObject({ revision: 2, published_posting_id: ids[0] })
  expect((await call(route, { ...body, operationId: crypto.randomUUID() })).status).toBe(409)
  expect(await count('job_postings')).toBe(1)
  expect(await count('create_operations')).toBe(1)
})

it('preserves draft revision protection when concurrent publications use different operation keys', async () => {
  const route = routes[0]
  const body = { ...route.body, draftId: await draftFor(), draftRevision: 1 }
  const responses = await Promise.all([call(route, { ...body, operationId: crypto.randomUUID() }),
    call(route, { ...body, operationId: crypto.randomUUID() })])
  expect(responses.map(response => response.status).sort()).toEqual([201, 409])
  expect(await count('job_postings')).toBe(1)
  expect(await count('create_operations')).toBe(1)
})

it('hashes normalized optional posting fields while detecting a changed description or draft revision', async () => {
  const route = routes[0]
  const body = { ...route.body, operationId: crypto.randomUUID(), wageType: 'hourly', wageMin: '12,000 원',
    draftId: await draftFor(), draftRevision: 1 }
  expect((await call(route, body)).status).toBe(201)
  expect((await call(route, { ...body, wageMin: 12000, department: null })).status).toBe(200)
  expect((await call(route, { ...body, description: '수정된 본문' })).status).toBe(409)
  expect((await call(route, { ...body, draftRevision: 2 })).status).toBe(409)
  expect(await count('job_postings')).toBe(1)
})

it('rolls back draft publication and its revision when receipt insertion fails', async () => {
  const route = routes[0]
  const body = { ...route.body, operationId: crypto.randomUUID(), draftId: await draftFor(), draftRevision: 1 }
  failQuery = query => query.includes('INSERT INTO create_operations')
  expect((await call(route, body)).status).toBe(503)
  expect((await pg.query('SELECT revision, published_at, published_posting_id FROM posting_drafts WHERE id = $1', [body.draftId])).rows[0])
    .toEqual({ revision: 1, published_at: null, published_posting_id: null })
  expect(await count('job_postings')).toBe(0)
  expect(await count('create_operations')).toBe(0)
  failQuery = null
  expect((await call(route, body)).status).toBe(201)
})

it('does not claim a missing, other-owned, or stale draft operation', async () => {
  const route = routes[0]
  for (const [draftId, draftRevision] of [[crypto.randomUUID(), 1], [await draftFor(other), 1], [await draftFor(), 2]]) {
    expect((await call(route, { ...route.body, operationId: crypto.randomUUID(), draftId, draftRevision })).status).toBe(409)
  }
  expect(await count('job_postings')).toBe(0)
  expect(await count('create_operations')).toBe(0)
})

it('keeps a committed posting replayable even when best-effort audit logging fails', async () => {
  const route = routes[0]
  const body = { ...route.body, operationId: crypto.randomUUID() }
  failQuery = query => query.includes('INSERT INTO admin_audit_log')
  expect((await call(route, body)).status).toBe(201)
  expect((await call(route, body)).status).toBe(200)
  expect(await count('job_postings')).toBe(1)
  expect(await count('create_operations')).toBe(1)
})

it('stores only a compact private receipt with a DB-enforced composite key and account-lifetime cleanup', async () => {
  const route = routes[1]
  const body = { ...route.body, operationId: crypto.randomUUID() }
  const result = await (await call(route, body)).json()
  const row = (await pg.query('SELECT * FROM create_operations')).rows[0]
  expect(Object.keys(row).sort()).toEqual(['created_at', 'kind', 'operation_id', 'owner_user_id', 'payload_hash', 'resource_id'])
  expect(row.payload_hash).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(row)).not.toContain(body.title)
  expect(JSON.stringify(row)).not.toContain(result.inviteCode)
  expect((await pg.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'create_operations'")).rows[0].relrowsecurity).toBe(true)
  for (const role of ['anon', 'authenticated']) {
    expect((await pg.query("SELECT has_table_privilege($1, 'create_operations', 'SELECT,INSERT,UPDATE,DELETE') AS allowed", [role])).rows[0].allowed).toBe(false)
  }
  await expect(pg.query('INSERT INTO create_operations SELECT * FROM create_operations')).rejects.toMatchObject({ code: '23505' })
  await pg.query('DELETE FROM room_participants WHERE room_id = $1', [result.id])
  await pg.query('DELETE FROM interview_rooms WHERE id = $1', [result.id])
  expect(await count('create_operations')).toBe(1)
  await pg.query('DELETE FROM users WHERE id = $1', [owner.id])
  expect(await count('create_operations')).toBe(0)
})
