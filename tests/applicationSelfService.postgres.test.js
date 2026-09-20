import { beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { hashCapability } from '../server/_lib/applicationAccess.js'
import { onRequestPost as exchange } from '../server/api/application-access/exchange.js'
import { onRequestGet as get, onRequestPatch as edit } from '../server/api/application-self-service/[id]/index.js'
import { onRequestPost as withdraw } from '../server/api/application-self-service/[id]/withdraw.js'
import { onRequestPost as pass } from '../server/api/applications/[id]/pass.js'
import { onRequestPost as reject } from '../server/api/applications/[id]/reject.js'
import { onRequestPost as apply } from '../server/api/jobs/[id]/apply.js'
import { CONSENT_VERSION } from '../src/lib/consentText.js'
import { cleanExpiredRecoveryData } from '../server/_lib/retention.js'
vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Real database forbidden') } }))
let pg, db, env, seq = 0
const token = 'e'.repeat(64)
function adapter(client) { return {
  async unsafe(sql, values = []) { const result = await client.query(sql, values); return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length }) },
  begin(callback) { return client.transaction(tx => callback(adapter(tx))) },
} }
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets (id TEXT PRIMARY KEY,name TEXT,public BOOLEAN,file_size_limit BIGINT);')
  for (const file of ['202609030001_cloudflare_to_supabase.sql','202609120002_posting_drafts.sql','202609130001_audit_remediation.sql','202609190001_application_result_email.sql','202609190002_account_recovery.sql','202609190003_application_self_service.sql']) {
    await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  }
  await pg.exec(readFileSync('supabase/migrations/202609190003_application_self_service.sql', 'utf8'))
  db = new PostgresD1(adapter(pg))
  await db.prepare(`INSERT INTO users (id,email,password_hash,password_salt,role,display_name,is_recruiter)
    VALUES ('owner','owner@example.invalid','unused','unused','company','Owner',1)` ).run()
  await db.prepare("INSERT INTO job_postings (id,created_by_user_id,title,description) VALUES ('posting','owner','Role','Description')").run()
  await db.prepare('INSERT INTO application_access_sessions (token_hash,email,expires_at) VALUES (?,?,?)')
    .bind(await hashCapability(token), 'candidate@example.invalid', new Date(Date.now()+3600_000).toISOString()).run()
}, 30_000)
beforeEach(() => {
  env = { DB: db, DOCUMENTS: { put: vi.fn(async () => {}), delete: vi.fn(async () => {}) } }
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Provider requests prohibited') }))
})
afterEach(() => vi.unstubAllGlobals())
afterAll(async () => pg?.close())
async function fixture() {
  const id = `pg-app-${++seq}`
  await db.prepare(`INSERT INTO applications (id,posting_id,applicant_name,applicant_email,applicant_phone,consent_required)
    VALUES (?,'posting','Original','candidate@example.invalid','010',1)`).bind(id).run()
  await db.prepare(`INSERT INTO application_documents (id,application_id,doc_type,filename,r2_key,size_bytes,content_type)
    VALUES (?,?,'resume','old.pdf',?,8,'application/pdf')`).bind(`doc-${id}`,id,`storage-${id}`).run()
  return id
}
const ctx = (id, body, user = null) => ({ env, data: { user }, params: { id }, request: new Request('https://test.invalid/api/self', {
  method: 'POST', headers: { 'X-Application-Authorization': `Bearer ${token}` }, body: body instanceof FormData ? body : JSON.stringify(body || {}),
}) })
function form() {
  const body = new FormData()
  for (const [key,value] of Object.entries({ applicantName:'Updated', applicantPhone:'011', careerJson:'[]', consentOptional:'false',
    consentRequired:'true', consentVersion:CONSENT_VERSION, revision:'0', operationToken:'f'.repeat(64) })) body.append(key,value)
  return body
}
it('keeps both capability tables private and consumes an inbox proof once under PostgreSQL concurrency', async () => {
  const hash = await hashCapability('1'.repeat(64))
  await db.prepare('INSERT INTO application_access_tokens (token_hash,email,expires_at) VALUES (?,?,?)')
    .bind(hash,'candidate@example.invalid',new Date(Date.now()+60_000).toISOString()).run()
  const replies = await Promise.all([exchange(ctx('',{token:'1'.repeat(64)})),exchange(ctx('',{token:'1'.repeat(64)}))])
  expect(replies.map(response=>response.status).sort()).toEqual([200,401])
  const result = await pg.query("SELECT relrowsecurity FROM pg_class WHERE relname IN ('application_access_tokens','application_access_sessions')")
  expect(result.rows.every(row=>row.relrowsecurity)).toBe(true)
  for (const table of ['application_access_tokens','application_access_sessions','application_upload_staging']) {
    expect((await pg.query(`SELECT has_table_privilege('anon','${table}','SELECT') AS allowed`)).rows[0].allowed).toBe(false)
    expect((await pg.query(`SELECT has_table_privilege('authenticated','${table}','SELECT') AS allowed`)).rows[0].allowed).toBe(false)
  }
})
it('persists the pre-review edit and denies a stale revision through the actual adapter', async () => {
  const id = await fixture()
  expect((await edit(ctx(id,form()))).status).toBe(200)
  expect((await edit(ctx(id,form()))).status).toBe(409)
  expect((await (await get(ctx(id))).json()).application).toMatchObject({ applicantName:'Updated',revision:1 })
  await withdraw(ctx(id,{revision:1}))
})
it('atomically chooses either withdrawal or reviewer rejection, never both', async () => {
  const id = await fixture()
  const owner = await db.prepare("SELECT * FROM users WHERE id='owner'").first()
  const replies = await Promise.all([withdraw(ctx(id,{revision:0})),reject(ctx(id,{},owner))])
  expect(replies.filter(response=>response.ok)).toHaveLength(1)
  const row = await db.prepare('SELECT status,withdrawn_at FROM applications WHERE id=?').bind(id).first()
  expect(row.withdrawn_at ? row.status==='submitted' : row.status==='rejected').toBe(true)
  expect(fetch).not.toHaveBeenCalled()
})
it('withdrawal blocks approval and releases the duplicate-submission index for a new application', async () => {
  const id = await fixture()
  expect((await withdraw(ctx(id,{revision:0}))).status).toBe(200)
  const owner = await db.prepare("SELECT * FROM users WHERE id='owner'").first()
  expect((await pass(ctx(id,{},owner))).status).toBe(409)
  const next = await fixture()
  expect(next).not.toBe(id)
  await withdraw(ctx(next,{revision:0}))
})
it('reuses an unpredictable submission operation without a second record on PostgreSQL', async () => {
  const body = form(); body.set('applicantEmail','new-applicant@example.invalid'); body.append('resume',new File(['%PDF-1.4'], 'resume.pdf'))
  const first = await apply(ctx('posting',body))
  expect(first.status).toBe(201)
  const receipt = await first.json()
  const replay = form(); replay.set('applicantEmail','new-applicant@example.invalid'); replay.append('resume',new File(['%PDF-1.4'],'resume.pdf'))
  const second = await (await apply(ctx('posting',replay))).json()
  expect(second.applicationId).toBe(receipt.applicationId)
  expect(second.lookupCode).toBe(receipt.lookupCode)
  expect(env.DOCUMENTS.put).toHaveBeenCalledOnce()
})
it('cleans expired email and password proof records through the PostgreSQL adapter without clearing live access', async () => {
  await db.prepare("INSERT INTO application_access_tokens(token_hash,email,expires_at) VALUES('expired-proof','old@example.invalid','2000-01-01')").run()
  await db.prepare("INSERT INTO application_access_sessions(token_hash,email,expires_at) VALUES('expired-session','old@example.invalid','2000-01-01')").run()
  await db.prepare("INSERT INTO account_recovery_tokens(token_hash,user_id,purpose,email,password_snapshot,expires_at) VALUES('expired-reset','owner','reset_password','old@example.invalid','unused','2000-01-01')").run()
  expect(await cleanExpiredRecoveryData(env)).toMatchObject({pending:3,deleted:0})
  expect(await cleanExpiredRecoveryData(env,{dryRun:false})).toMatchObject({pending:3,deleted:3})
  expect(await db.prepare('SELECT token_hash FROM application_access_sessions WHERE token_hash=?').bind(await hashCapability(token)).first()).toBeTruthy()
})
