import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { hashCapability } from '../server/_lib/applicationAccess.js'
import { onRequestPost as requestAccess } from '../server/api/application-access/request.js'
import { onRequestPost as exchange } from '../server/api/application-access/exchange.js'
import { onRequestPost as receipt } from '../server/api/application-receipt.js'
import { onRequestGet as list } from '../server/api/application-self-service/index.js'
import { onRequestGet as detail, onRequestPatch as edit } from '../server/api/application-self-service/[id]/index.js'
import { onRequestPost as withdraw } from '../server/api/application-self-service/[id]/withdraw.js'
import { onRequestGet as download } from '../server/api/application-self-service/[id]/doc/[docId].js'
import { onRequestPost as apply } from '../server/api/jobs/[id]/apply.js'
import { onRequestPost as pass } from '../server/api/applications/[id]/pass.js'
import { onRequestPost as reject } from '../server/api/applications/[id]/reject.js'
import { onRequestPost as screen } from '../server/api/applications/[id]/screen.js'
import { screenApplication } from '../server/_lib/claude.js'
import { CONSENT_VERSION } from '../src/lib/consentText.js'
import { cleanStagedApplicationUploads } from '../server/_lib/applicationUploadCleanup.js'
vi.mock('../server/_lib/claude.js', () => ({ screenApplication: vi.fn() }))

let db, env, owner, token, network, objects
const capability = 'a'.repeat(64)
const operation = 'b'.repeat(64)
const document = () => new File(['%PDF-1.4\nfixture'], 'resume.pdf', { type: 'application/pdf' })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const read = () => db.sql.prepare("SELECT * FROM applications WHERE id = 'app'").get()
const context = (body, options = {}) => ({ env, data: { user: options.user || null },
  params: { id: options.id || 'app', docId: options.docId || 'doc' },
  request: new Request('https://test.invalid/api/application-self-service/app', {
    method: options.method || 'POST', headers: { 'CF-Connecting-IP': 'test-ip',
      ...(token ? { 'X-Application-Authorization': `Bearer ${token}` } : {}), ...options.headers },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  }) })
function form(revision = 0) {
  const data = new FormData()
  for (const [key, value] of Object.entries({ applicantName: '수정한 이름', applicantEmail: 'candidate@example.invalid',
    applicantPhone: '010-1111-1111', careerJson: '[]', consentOptional: 'false', consentRequired: 'true',
    consentVersion: CONSENT_VERSION, revision: String(revision), operationToken: operation })) data.append(key, value)
  return data
}
beforeEach(async () => {
  db = sqliteApp()
  owner = seedUser(db, 'owner', 'company', { recruiter: 1 })
  seedUser(db, 'candidate')
  db.sql.exec(`INSERT INTO job_postings (id,created_by_user_id,title,description) VALUES ('posting','owner','공고','상세');
    INSERT INTO applications (id,posting_id,applicant_name,applicant_email,applicant_phone,lookup_code,created_user_id,consent_required)
      VALUES ('app','posting','이름','candidate@example.invalid','010-0000-0000','ABCD2345EF','candidate',1);
    INSERT INTO application_documents (id,application_id,doc_type,filename,r2_key,size_bytes,content_type)
      VALUES ('doc','app','resume','old.pdf','old-document',16,'application/pdf');`)
  objects = new Map([['old-document', new Uint8Array([37,80,68,70])]])
  env = { DB: db, EMAIL_ENABLED: '1', GMAIL_CLIENT_ID: 'fixture', GMAIL_CLIENT_SECRET: 'fixture',
    GMAIL_REFRESH_TOKEN: 'fixture', FINAL_OFFER_FROM_EMAIL: 'sender@example.invalid', DOCUMENTS: {
      put: vi.fn(async (key, stream) => objects.set(key, new Uint8Array(await new Response(stream).arrayBuffer()))),
      delete: vi.fn(async key => objects.delete(key)), get: vi.fn(async key => objects.has(key) ? { body: objects.get(key) } : null),
    } }
  token = capability
  await db.prepare('INSERT INTO application_access_sessions (token_hash,email,expires_at) VALUES (?,?,?)')
    .bind(await hashCapability(capability), 'candidate@example.invalid', new Date(Date.now() + 60_000).toISOString()).run()
  network = vi.fn(async url => Response.json(String(url).includes('oauth2') ? { access_token: 'fixture' } : { id: 'fixture-receipt' }))
  vi.stubGlobal('fetch', network)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('inbox proof and applicant access', () => {
  it('sends the same generic response with or without an existing application, keeping secrets hashed and in fragments', async () => {
    const replies = []
    for (const email of ['candidate@example.invalid', 'absent@example.invalid']) replies.push(await (await requestAccess(context({ email }))).json())
    expect(replies[0]).toEqual(replies[1])
    const send = network.mock.calls.find(([url]) => String(url).includes('/messages/send'))
    const mime = Buffer.from(JSON.parse(send[1].body).raw, 'base64url').toString()
    const plain = Buffer.from(mime.match(/Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/)[1], 'base64').toString()
    const proof = plain.match(/application-manage#token=([a-f0-9]{64})/)[1]
    const rows = db.sql.prepare('SELECT token_hash FROM application_access_tokens').all()
    expect(rows.some(row => row.token_hash === proof)).toBe(false)
    const response = await exchange(context({ token: proof }))
    expect(response.status).toBe(200)
    const session = await response.json()
    expect(session.token).toMatch(/^[a-f0-9]{64}$/)
    expect((await exchange(context({ token: proof }))).status).toBe(401)
    token = session.token
    expect((await (await list(context())).json()).applications).toHaveLength(1)
  })
  it('rejects expired proof and expired sessions', async () => {
    await db.prepare('INSERT INTO application_access_tokens (token_hash,email,expires_at) VALUES (?,?,?)')
      .bind(await hashCapability(operation), 'candidate@example.invalid', '2000-01-01').run()
    expect((await exchange(context({ token: operation }))).status).toBe(401)
    db.sql.exec("UPDATE application_access_sessions SET expires_at='2000-01-01'")
    expect((await list(context())).status).toBe(401)
  })
  it('never trusts an unverified account email or lookup code as edit authority', async () => {
    token = null
    const result = await edit(context(form(), { user: { id: 'imposter', email: 'candidate@example.invalid', role: 'candidate' }, headers: { 'X-Lookup-Code': 'ABCD2345EF' } }))
    expect(result.status).toBe(401)
    expect(read().revision).toBe(0)
  })
  it('restricts list, detail and attachment access to the verified inbox', async () => {
    db.sql.exec("INSERT INTO applications (id,posting_id,applicant_name,applicant_email,applicant_phone) VALUES ('other','posting','Other','other@example.invalid','010')")
    expect((await (await list(context())).json()).applications.map(row => row.id)).toEqual(['app'])
    expect((await detail(context(undefined, { id: 'other', method: 'GET' }))).status).toBe(404)
    expect((await download(context(undefined, { id: 'other', method: 'GET' }))).status).toBe(404)
    expect((await download(context(undefined, { method: 'GET' }))).status).toBe(200)
  })
  it('does not expose AI assessment or storage keys in the applicant detail', async () => {
    db.sql.exec(`UPDATE applications SET ai_screening_json='{"summary":"private assessment"}'`)
    const text = await (await detail(context())).text()
    expect(text).not.toMatch(/private assessment|old-document|r2_key/)
    expect(text).toContain('ABCD2345EF')
  })
})

describe('pre-review correction and withdrawal', () => {
  it('replaces files atomically, retains previous originals, and invalidates old screening', async () => {
    db.sql.exec(`UPDATE applications SET ai_screening_json='{}',screened_at=datetime('now')`)
    const data = form(); data.append('resume', document())
    const response = await edit(context(data))
    expect(response.status).toBe(200)
    expect(read()).toMatchObject({ applicant_name: '수정한 이름', revision: 1, ai_screening_json: null, screened_at: null })
    expect(objects.has('old-document')).toBe(true)
    expect(db.sql.prepare('SELECT count(*) n FROM application_documents').get().n).toBe(2)
    expect((await (await detail(context())).json()).application.documents).toHaveLength(1)
    expect((await download(context())).status).toBe(404)
  })
  it('refuses stale versions without rewriting documents even when the same operation token is reused', async () => {
    expect((await edit(context(form()))).status).toBe(200)
    const second = form(); second.append('resume', document())
    expect((await edit(context(second))).status).toBe(409)
    expect(read().revision).toBe(1)
    expect(env.DOCUMENTS.put).not.toHaveBeenCalled()
  })
  it('requires the reviewer to acknowledge a changed revision before deciding or screening', async () => {
    await edit(context(form()))
    expect((await reject(context({ revision: 0 }, { user: owner }))).status).toBe(409)
    expect((await pass(context({}, { user: owner }))).status).toBe(409)
    expect((await screen(context({ revision: 0 }, { user: owner }))).status).toBe(409)
    expect(network).not.toHaveBeenCalled()
    expect((await reject(context({ revision: 1 }, { user: owner }))).status).toBe(200)
  })
  it('validates real attachment content before upload', async () => {
    const data = form(); data.append('resume', new File(['not pdf'], 'fake.pdf'))
    expect((await edit(context(data))).status).toBe(400)
    expect(env.DOCUMENTS.put).not.toHaveBeenCalled()
    expect(read().revision).toBe(0)
  })
  it('preserves the original after a storage failure', async () => {
    env.DOCUMENTS.put.mockRejectedValueOnce(new Error('storage down'))
    const data = form(); data.append('resume', document())
    expect((await edit(context(data))).status).toBe(502)
    expect(read().revision).toBe(0)
    expect(objects.has('old-document')).toBe(true)
  })
  it('retains referenced replacement files when the database commits but its response is lost', async () => {
    const batch = db.batch.bind(db)
    db.batch = async statements => { await batch(statements); throw new Error('lost commit response') }
    const data = form(); data.append('resume', document())
    expect((await edit(context(data))).status).toBe(503)
    expect(read().revision).toBe(1)
    const active = db.sql.prepare('SELECT r2_key FROM application_documents WHERE superseded_at IS NULL').get()
    expect(objects.has(active.r2_key)).toBe(true)
    expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  })
  it('keeps a replacement staged when an uncertain transaction commits only after the error response', async () => {
    const batch = db.batch.bind(db); let pending
    db.batch = async statements => { pending = statements; throw new Error('database transport interrupted') }
    const data = form(); data.append('resume', document())
    expect((await edit(context(data))).status).toBe(503)
    expect(read().revision).toBe(0)
    expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
    expect(db.sql.prepare('SELECT count(*) n FROM application_upload_staging').get().n).toBe(1)
    await batch(pending)
    db.sql.exec("UPDATE application_upload_staging SET created_at='2000-01-01'")
    expect(await cleanStagedApplicationUploads(env, { dryRun: false })).toMatchObject({ cleaned: 1 })
    const active = db.sql.prepare('SELECT r2_key FROM application_documents WHERE superseded_at IS NULL').get()
    expect(objects.has(active.r2_key)).toBe(true)
    expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  })
  it('keeps failed cleanup queued and retention retries only unreferenced expired staging objects', async () => {
    const pending = deferred(); const started = deferred()
    env.DOCUMENTS.put.mockImplementationOnce(async (key, stream) => { objects.set(key, await new Response(stream).arrayBuffer()); started.resolve(); await pending.promise })
    env.DOCUMENTS.delete.mockRejectedValueOnce(new Error('temporary storage outage'))
    const data = form(); data.append('resume', document())
    const editing = edit(context(data)); await started.promise
    await withdraw(context({ revision: 0 })); pending.resolve()
    expect((await editing).status).toBe(409)
    expect(db.sql.prepare('SELECT count(*) n FROM application_upload_staging').get().n).toBe(1)
    db.sql.exec("UPDATE application_upload_staging SET created_at='2000-01-01'")
    expect(await cleanStagedApplicationUploads(env, { dryRun: false })).toMatchObject({ cleaned: 1, failed: 0 })
    expect(objects.size).toBe(1)
    expect(objects.has('old-document')).toBe(true)
  })
  it.each(['passed', 'rejected'])('does not edit or withdraw a %s application', async status => {
    db.sql.prepare('UPDATE applications SET status=?').run(status)
    expect((await edit(context(form()))).status).toBe(409)
    expect((await withdraw(context({ revision: 0 }))).status).toBe(409)
  })
  it('withdraws idempotently without sending a result email or permitting review', async () => {
    expect((await withdraw(context({ revision: 0 }))).status).toBe(200)
    expect((await withdraw(context({ revision: 0 }))).status).toBe(200)
    expect((await pass(context({}, { user: owner }))).status).toBe(409)
    expect((await reject(context({}, { user: owner }))).status).toBe(409)
    expect((await screen(context({}, { user: owner }))).status).toBe(409)
    expect((await (await detail(context())).json()).application).toMatchObject({ status: 'withdrawn', canEdit: false, canWithdraw: false })
    expect(network).not.toHaveBeenCalled()
  })
  it('discards an AI result if the applicant edits while the model is working', async () => {
    const pending = deferred(); screenApplication.mockReturnValueOnce(pending.promise)
    const reviewing = screen(context({}, { user: owner }))
    await vi.waitFor(() => expect(screenApplication).toHaveBeenCalled())
    expect((await edit(context(form()))).status).toBe(200)
    pending.resolve({ summary: 'obsolete', fit: 'high' })
    expect((await reviewing).status).toBe(409)
    expect(read().ai_screening_json).toBeNull()
  })
  it('a review winning during replacement upload prevents correction and cleans its unused upload', async () => {
    const pending = deferred(); const started = deferred()
    env.DOCUMENTS.put.mockImplementationOnce(async (key, stream) => { objects.set(key, await new Response(stream).arrayBuffer()); started.resolve(); await pending.promise })
    const data = form(); data.append('resume', document())
    const editing = edit(context(data)); await started.promise
    expect((await reject(context({}, { user: owner }))).status).toBe(200)
    pending.resolve()
    expect((await editing).status).toBe(409)
    expect(read().applicant_name).toBe('이름')
    expect(env.DOCUMENTS.delete).toHaveBeenCalledOnce()
    expect(objects.size).toBe(1)
  })
})

describe('safe submission receipt recovery', () => {
  const applicationForm = () => { const data = form(); data.append('resume', document()); return data }
  beforeEach(() => { db.sql.exec("DELETE FROM application_documents; DELETE FROM applications") })
  it('returns the original receipt for retries, including after the posting closes', async () => {
    const first = await (await apply(context(applicationForm(), { id: 'posting' }))).json()
    db.sql.exec("UPDATE job_postings SET status='closed'")
    const second = await (await apply(context(applicationForm(), { id: 'posting' }))).json()
    expect(second).toMatchObject({ applicationId: first.applicationId, lookupCode: first.lookupCode, recovered: true })
    expect(db.sql.prepare('SELECT count(*) n FROM applications').get().n).toBe(1)
    expect(env.DOCUMENTS.put).toHaveBeenCalledOnce()
    const recovered = await (await receipt(context({ postingId: 'posting', operationToken: operation }))).json()
    expect(recovered.lookupCode).toBe(first.lookupCode)
  })
  it('recovers a committed submission after a lost database response without deleting its attachment', async () => {
    const batch = db.batch.bind(db)
    db.batch = async statements => { await batch(statements); throw new Error('lost commit response') }
    const result = await apply(context(applicationForm(), { id: 'posting' }))
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ ok: true, recovered: true })
    const doc = db.sql.prepare('SELECT r2_key FROM application_documents').get()
    expect(objects.has(doc.r2_key)).toBe(true)
    expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  })
  it('keeps an uncertain submission upload until a late commit becomes visible', async () => {
    const batch = db.batch.bind(db); let pending
    db.batch = async statements => { pending = statements; throw new Error('database transport interrupted') }
    expect((await apply(context(applicationForm(), { id: 'posting' }))).status).toBe(503)
    expect(db.sql.prepare('SELECT count(*) n FROM applications').get().n).toBe(0)
    expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
    await batch(pending)
    db.sql.exec("UPDATE application_upload_staging SET created_at='2000-01-01'")
    expect(await cleanStagedApplicationUploads(env, { dryRun: false })).toMatchObject({ cleaned: 1 })
    expect(objects.has(db.sql.prepare('SELECT r2_key FROM application_documents').get().r2_key)).toBe(true)
    expect((await (await receipt(context({ postingId: 'posting', operationToken: operation }))).json()).status).toBe('submitted')
  })
  it('reports a withdrawn prior receipt honestly and allows a new operation to apply again', async () => {
    const first = await (await apply(context(applicationForm(), { id: 'posting' }))).json()
    await withdraw(context({ revision: 0 }, { id: first.applicationId }))
    expect(await (await receipt(context({ postingId: 'posting', operationToken: operation }))).json()).toMatchObject({ applicationId: first.applicationId, status: 'withdrawn' })
    expect(await (await apply(context(applicationForm(), { id: 'posting' }))).json()).toMatchObject({ applicationId: first.applicationId, status: 'withdrawn', recovered: true })
    const retry = applicationForm(); retry.set('operationToken', 'c'.repeat(64))
    const next = await apply(context(retry, { id: 'posting' }))
    expect(next.status).toBe(201)
    expect((await next.json()).applicationId).not.toBe(first.applicationId)
    expect(db.sql.prepare('SELECT count(*) n FROM applications').get().n).toBe(2)
  })
  it('does not reveal a receipt based on email or a different operation token', async () => {
    await apply(context(applicationForm(), { id: 'posting' }))
    const data = applicationForm(); data.set('operationToken', 'c'.repeat(64))
    const duplicate = await apply(context(data, { id: 'posting' }))
    expect(duplicate.status).toBe(409)
    expect(await duplicate.text()).not.toContain('lookupCode')
    expect((await receipt(context({ postingId: 'posting', operationToken: 'c'.repeat(64), email: 'candidate@example.invalid' }))).status).toBe(404)
    expect((await receipt(context({ postingId: 'different', operationToken: operation }))).status).toBe(404)
  })
  it('coalesces simultaneous retries into one application and cleans the unused file', async () => {
    const responses = await Promise.all([apply(context(applicationForm(), { id: 'posting' })), apply(context(applicationForm(), { id: 'posting' }))])
    const bodies = await Promise.all(responses.map(response => response.json()))
    expect(bodies[0].applicationId).toBe(bodies[1].applicationId)
    expect(db.sql.prepare('SELECT count(*) n FROM applications').get().n).toBe(1)
    expect(objects.size).toBe(2) // fixture original plus exactly one submitted attachment
  })
})
