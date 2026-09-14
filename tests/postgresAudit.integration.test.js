import { beforeAll, afterAll, it, expect, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { checkRateLimit } from '../server/_lib/rateLimit.js'
import { createSession, getSessionUser, getRoomSessionUser } from '../server/_lib/auth.js'
import { onRequestGet as getThreads } from '../server/api/dm/index.js'
import { SIGNAL_INBOX_SQL } from '../server/_lib/interviewSignaling.js'
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
  for (const file of ['202609030001_cloudflare_to_supabase.sql', '202609120002_posting_drafts.sql', '202609130001_audit_remediation.sql', '202609130002_retention_schedule.sql', '202609140001_hot_path_indexes.sql']) {
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

it('loads the actual message inbox query on PostgreSQL without leaking other conversations', async () => {
  for (const id of ['dm-me', 'dm-other', 'dm-stranger']) {
    await db.prepare("INSERT INTO users (id,email,password_hash,password_salt,role,display_name) VALUES (?,?,'unused','unused','candidate',?)")
      .bind(id, `${id}@example.invalid`, id).run()
  }
  for (const [from, to, body] of [['dm-other', 'dm-me', 'first'], ['dm-me', 'dm-other', 'reply'], ['dm-other', 'dm-stranger', 'not mine']]) {
    await db.prepare('INSERT INTO direct_messages (sender_id,recipient_id,body) VALUES (?,?,?)').bind(from, to, body).run()
  }
  const response = await getThreads({ env: { DB: db }, data: { user: { id: 'dm-me' } } })
  const body = await response.json()
  expect(body.threads).toHaveLength(1)
  expect(body.threads[0]).toMatchObject({ partner: { id: 'dm-other' }, lastBody: 'reply', lastFromMe: true, unread: 1 })
  expect(body.unreadTotal).toBe(1)
  expect(JSON.stringify(body)).not.toContain('not mine')
})

it('uses the recent-inbox index instead of scanning expired signal history', async () => {
  await pg.exec(`INSERT INTO users (id,email,password_hash,password_salt,role,display_name) VALUES ('index-user','index@example.invalid','unused','unused','company','Test');
    INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code) VALUES ('index-room','index-user','Test','active','INDEX2345ABC');
    INSERT INTO interview_sessions (id,room_id,provider_meeting_id,title,status) VALUES ('index-session','index-room','index-meeting','Test','live');
    INSERT INTO interview_signals (session_id,sender_id,recipient_id,payload,created_at)
      SELECT 'index-session','sender','recipient','{}', CASE WHEN n <= 10000 THEN '2000-01-01 00:00:00' ELSE datetime('now') END
      FROM generate_series(1,10003) AS n;
    INSERT INTO interview_signals (session_id,sender_id,recipient_id,payload)
      SELECT 'index-session','sender','other-recipient','{}' FROM generate_series(1,10000);
    ANALYZE interview_signals;`)
  const { results: rows } = await db.prepare(`EXPLAIN (ANALYZE, FORMAT JSON) ${SIGNAL_INBOX_SQL}`).bind('index-session', 'recipient').all()
  const plan = rows[0]['QUERY PLAN'][0].Plan
  const nodes = (node) => [node, ...(node.Plans || []).flatMap(nodes)]
  expect(nodes(plan).some((n) => n['Index Name'] === 'interview_signals_recent_inbox'), JSON.stringify(plan)).toBe(true)
  expect(plan['Actual Rows']).toBe(3)
  expect(nodes(plan).reduce((n, p) => n + (p['Rows Removed by Filter'] || 0), 0)).toBe(0)
})
