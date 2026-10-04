import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { onRequestGet as list } from '../server/api/applications/index.js'
vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Real database forbidden') } }))
let pg, db
const owner = { id: 'owner', role: 'company', is_recruiter: 1 }
function adapter(client) { return {
  async unsafe(sql, values = []) { const result = await client.query(sql, values); return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length }) },
  begin(callback) { return client.transaction(tx => callback(adapter(tx))) },
} }
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id TEXT PRIMARY KEY,name TEXT,public BOOLEAN,file_size_limit BIGINT);')
  for (const file of ['202609030001_cloudflare_to_supabase.sql', '202609120002_posting_drafts.sql', '202609130001_audit_remediation.sql', '202609190001_application_result_email.sql', '202609190002_account_recovery.sql', '202609190003_application_self_service.sql']) await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  db = new PostgresD1(adapter(pg))
  await pg.exec("INSERT INTO users(id,email,password_hash,password_salt,role,display_name,is_recruiter) VALUES('owner','owner@example.invalid','unused','unused','company','Owner',1); INSERT INTO job_postings(id,created_by_user_id,title,description) VALUES('posting','owner','공고','Description');")
  await pg.query("INSERT INTO applications(id,posting_id,applicant_name,applicant_email,applicant_phone,created_at,consent_required) SELECT 'app-' || lpad(n::text,4,'0'),'posting',CASE WHEN n=0 THEN '50%_지원자' ELSE '후보 ' || n END,'candidate-' || n || '@example.invalid','010','2026-01-01T00:00:00Z',1 FROM generate_series(0,200) n")
}, 30_000)
afterAll(async () => pg?.close())
async function read(query = '') {
  const response = await list({ env: { DB: db }, data: { user: owner }, request: new Request(`https://test.invalid/api/applications${query ? `?${query}` : ''}`) })
  expect(response.status).toBe(200)
  return response.json()
}
it('runs the actual PostgreSQL cursor and escaped whole-list filter through the deployed adapter', async () => {
  const ids = []
  let cursor
  do {
    const page = await read(`status=submitted&posting=posting${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    ids.push(...page.applications.map(row => row.id)); cursor = page.nextCursor
  } while (cursor)
  expect(ids).toEqual(Array.from({ length: 201 }, (_, index) => `app-${String(200 - index).padStart(4, '0')}`))
  expect((await read('q=%25_')).applications.map(row => row.id)).toEqual(['app-0000'])
  expect((await read('q=존재하지않음')).applications).toEqual([])
})
