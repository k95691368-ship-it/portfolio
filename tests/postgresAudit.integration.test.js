import { beforeAll, afterAll, it, expect, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { checkRateLimit } from '../server/_lib/rateLimit.js'
import { createSession, getSessionUser, getRoomSessionUser } from '../server/_lib/auth.js'
vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Real database connections prohibited in tests') } }))

let pg, db
function adapter(client) {
  return {
    async unsafe(query, values = []) {
      const result = await client.query(query, values)
      return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length })
    },
    begin(operation) { return client.transaction((tx) => operation(adapter(tx))) },
  }
}
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT);')
  for (const file of ['202609030001_cloudflare_to_supabase.sql', '202609120002_posting_drafts.sql', '202609130001_audit_remediation.sql', '202609130002_retention_schedule.sql']) {
    await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  }
  db = new PostgresD1(adapter(pg))
}, 30000)
afterAll(async () => { await pg?.close() })

it('runs the real PostgreSQL migrations and adapter; 20 concurrent reservations respect limit 1', async () => {
  const tickets = await Promise.all(Array.from({ length: 20 }, () => checkRateLimit({ DB: db }, 'pg-test', 1, 60)))
  expect(tickets.filter(Boolean)).toHaveLength(1)
  const { rows } = await pg.query("SELECT relrowsecurity FROM pg_class WHERE relname IN ('email_outbox','retention_jobs','interview_signals')")
  expect(rows).toHaveLength(3)
  expect(rows.every((r) => r.relrowsecurity)).toBe(true)
})

it('enforces token scope using PostgreSQL, not just mocks or SQLite', async () => {
  await db.prepare("INSERT INTO users (id,email,password_hash,password_salt,role,display_name) VALUES ('pg-user','pg@example.invalid','unused','unused','candidate','Test')").run()
  const { token } = await createSession(db, 'pg-user', { authMethod: 'invite_code', scopedRoomId: 'one-room' })
  const request = new Request('https://test.invalid/api/me', { headers: { 'X-App-Authorization': `Bearer ${token}`, 'X-Room-Authorization': `Bearer ${token}` } })
  expect(await getSessionUser(db, request)).toBeNull()
  expect(await getRoomSessionUser(db, request, 'other-room')).toBeNull()
  expect((await getRoomSessionUser(db, request, 'one-room')).id).toBe('pg-user')
})
