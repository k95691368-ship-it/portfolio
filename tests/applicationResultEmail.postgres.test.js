import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { getApplicationResultEmail, sendApplicationResultNotification } from '../server/_lib/applicationResultEmail.js'
import { onRequestPost as passApplication } from '../server/api/applications/[id]/pass.js'
import { onRequestPost as rejectApplication } from '../server/api/applications/[id]/reject.js'

vi.mock('npm:postgres@3.4.7', () => ({
  default: () => { throw new Error('Real database connections prohibited in tests') },
}))

let pg, db, env, network, nextId = 0

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
  for (const file of [
    '202609030001_cloudflare_to_supabase.sql', '202609120002_posting_drafts.sql',
    '202609130001_audit_remediation.sql', '202609130002_retention_schedule.sql',
    '202609140001_hot_path_indexes.sql',
  ]) await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  await pg.exec(`INSERT INTO users (id,email,password_hash,password_salt,role,display_name,company_name,is_recruiter)
      VALUES ('owner','owner@example.invalid','unused','unused','company','채용 담당자','공고 소유 회사',1);
    INSERT INTO job_postings (id,created_by_user_id,title,description)
      VALUES ('posting','owner','운영 담당자 채용','공고 상세');
    INSERT INTO applications (id,posting_id,applicant_name,applicant_email,applicant_phone,status,reviewed_at)
      VALUES ('legacy','posting','이전 지원자','legacy@example.invalid','010-0000-0000','rejected','2026-09-01 00:00:00');`)
  const migration = readFileSync('supabase/migrations/202609190001_application_result_email.sql', 'utf8')
  await pg.exec(migration)
  await pg.exec(migration)
  await pg.exec(readFileSync('supabase/migrations/202609190003_application_self_service.sql', 'utf8'))
  db = new PostgresD1(adapter(pg))
}, 30000)

beforeEach(() => {
  env = {
    DB: db, EMAIL_ENABLED: '1', GMAIL_CLIENT_ID: 'fixture', GMAIL_CLIENT_SECRET: 'fixture',
    GMAIL_REFRESH_TOKEN: 'fixture', FINAL_OFFER_FROM_EMAIL: 'sender@example.invalid',
  }
  network = vi.fn(async (url) => Response.json(String(url).includes('oauth2')
    ? { access_token: 'fixture' } : { id: 'fixture-receipt' }))
  vi.stubGlobal('fetch', network)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
afterAll(async () => { await pg?.close() })

const providerCalls = () => network.mock.calls.filter(([url]) => String(url).includes('/messages/send'))
const load = (id) => db.prepare('SELECT * FROM applications WHERE id = ?').bind(id).first()

async function fixture(status = 'rejected', emailStatus = 'pending') {
  const id = `application-${++nextId}`
  const candidateId = `candidate-${nextId}`
  const email = `${candidateId}@example.invalid`
  await db.prepare(`INSERT INTO users (id,email,password_hash,password_salt,role,display_name)
    VALUES (?,?,'unused','unused','candidate','지원자 이름')`).bind(candidateId, email).run()
  let roomId = null
  if (status === 'passed') {
    roomId = `room-${nextId}`
    await db.prepare(`INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code)
      VALUES (?,'owner','면접방','active',?)`).bind(roomId, `ABCD2345EF${nextId}`).run()
  }
  await db.prepare(`INSERT INTO applications (id,posting_id,applicant_name,applicant_email,
    applicant_phone,status,created_user_id,room_id,result_email_status)
    VALUES (?,'posting','지원자 이름',?,'010-0000-0000',?,?,?,?)`)
    .bind(id, email, status, candidateId, roomId, emailStatus).run()
  return id
}

it('applies the real migration twice without changing prior review records or weakening RLS', async () => {
  const row = await load('legacy')
  expect(row).toMatchObject({ status: 'rejected', reviewed_at: '2026-09-01 00:00:00', result_email_status: null })
  expect(getApplicationResultEmail(row)).toMatchObject({ status: 'legacy_unknown', canRetry: false })
  expect(await sendApplicationResultNotification(env, 'legacy')).toMatchObject({ status: 'legacy_unknown', canRetry: false })
  expect(network).not.toHaveBeenCalled()
  const { rows } = await pg.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.applications'::regclass")
  expect(rows).toEqual([{ relrowsecurity: true }])
})

it.each([
  ['passed', passApplication, 201], ['rejected', rejectApplication, 200],
])('commits and emails a new %s decision using the real PostgreSQL adapter', async (status, decide, httpStatus) => {
  const id = await fixture('submitted', null)
  const user = await db.prepare("SELECT * FROM users WHERE id = 'owner'").first()
  const response = await decide({ env, data: { user }, params: { id } })
  expect(response.status).toBe(httpStatus)
  expect(await response.json()).toMatchObject({ status, emailStatus: 'sent', resultEmail: { status: 'sent', canRetry: false } })
  expect(await load(id)).toMatchObject({ status, result_email_status: 'sent', result_email_sent_at: expect.any(String) })
  expect(providerCalls()).toHaveLength(1)
})

it('persists a definite failure and safely retries it with PostgreSQL state transitions', async () => {
  const id = await fixture()
  network.mockResolvedValueOnce(Response.json({ error: 'invalid_grant' }, { status: 400 }))
  expect(await sendApplicationResultNotification(env, id)).toMatchObject({ status: 'failed', canRetry: true })
  expect((await load(id)).result_email_status).toBe('failed')
  expect(await sendApplicationResultNotification(env, id)).toMatchObject({ status: 'sent', canRetry: false })
  expect((await load(id)).result_email_sent_at).toEqual(expect.any(String))
  expect(providerCalls()).toHaveLength(1)
})

it('keeps an ambiguous Gmail outcome non-retryable after PostgreSQL reload', async () => {
  const id = await fixture()
  network.mockResolvedValueOnce(Response.json({ access_token: 'fixture' }))
    .mockRejectedValueOnce(new Error('provider timeout'))
  expect(await sendApplicationResultNotification(env, id)).toMatchObject({ status: 'unknown', canRetry: false })
  expect(getApplicationResultEmail(await load(id))).toMatchObject({ status: 'unknown', canRetry: false })
  expect(await sendApplicationResultNotification(env, id)).toMatchObject({ status: 'unknown', canRetry: false })
  expect(providerCalls()).toHaveLength(1)
})

it('claims concurrent PostgreSQL attempts exactly once before provider send', async () => {
  const id = await fixture('rejected', 'failed')
  let allowResponse, signalStarted
  const response = new Promise((resolve) => { allowResponse = resolve })
  const started = new Promise((resolve) => { signalStarted = resolve })
  network.mockImplementation(async (url) => {
    if (String(url).includes('oauth2')) return Response.json({ access_token: 'fixture' })
    signalStarted()
    return response
  })
  const first = sendApplicationResultNotification(env, id)
  await started
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => sendApplicationResultNotification(env, id)))
  expect(concurrent.every((state) => state.status === 'sending' && !state.canRetry)).toBe(true)
  allowResponse(Response.json({ id: 'fixture-receipt' }))
  expect(await first).toMatchObject({ status: 'sent', canRetry: false })
  expect(providerCalls()).toHaveLength(1)
  expect((await load(id)).result_email_status).toBe('sent')
})

it('rejects invalid persisted delivery statuses at the PostgreSQL boundary', async () => {
  const id = await fixture()
  await expect(db.prepare('UPDATE applications SET result_email_status = ? WHERE id = ?')
    .bind('delivered_without_evidence', id).run()).rejects.toThrow()
  expect((await load(id)).result_email_status).toBe('pending')
  expect(network).not.toHaveBeenCalled()
})
