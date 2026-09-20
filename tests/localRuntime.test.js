import { afterAll, beforeAll, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { buildLocalApi, offlineHtml } from '../scripts/local/build.mjs'
import { startLocalRuntime } from '../scripts/local/runtime.mjs'
import { CONSENT_VERSION } from '../src/lib/consentText.js'
import { archiveContract } from '../server/_lib/contractArchive.js'

let directory, siteDirectory, apiFile, dataDirectory, runtime
const password = () => randomBytes(24).toString('base64url')
const json = (body, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const auth = token => ({ 'X-App-Authorization': `Bearer ${token}` })
const access = token => ({ 'X-Application-Authorization': `Bearer ${token}` })
const call = (path, init) => fetch(`${runtime.origin}/api${path}`, init)
const payload = async (response, status = 200) => {
  // Assert statuses before reading bodies, so a failure cannot print credentials.
  expect(response.status).toBe(status)
  return response.json()
}
const freshToken = async (email, path) => {
  const message = (await runtime.mailbox.list()).find(row => row.to === email && row.text.includes(`/${path}#token=`))
  expect(Boolean(message)).toBe(true)
  const url = new URL(message.text.match(/http:\/\/127\.0\.0\.1:\d+\/[^\s]+/)[0])
  expect(url.origin).toBe(runtime.origin)
  expect(url.search).toBe('')
  return new URLSearchParams(url.hash.slice(1)).get('token')
}
const resume = '%PDF-1.4\nlocal byte-for-byte resume fixture\n%%EOF'
const form = (email, operation, revision = 0, name = '로컬 지원자') => {
  const data = new FormData()
  for (const [key, value] of Object.entries({ applicantName: name, applicantEmail: email, applicantPhone: '010-0000-0000',
    careerJson: '[]', consentRequired: 'true', consentOptional: 'false', consentVersion: CONSENT_VERSION,
    operationToken: operation, revision: String(revision) })) data.append(key, value)
  return data
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'portfolio-http-test-'))
  siteDirectory = join(directory, 'site'); dataDirectory = join(directory, 'state')
  await mkdir(siteDirectory)
  await writeFile(join(siteDirectory, 'index.html'), '<!doctype html><title>Fixture</title><body>Local fixture</body>')
  await writeFile(join(siteDirectory, '_headers'), "/*\n  Content-Security-Policy: default-src 'self'; connect-src 'self' https://example.invalid; media-src 'self' https://example.invalid; upgrade-insecure-requests\n  Strict-Transport-Security: max-age=31536000\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n")
  apiFile = await buildLocalApi(join(directory, 'bundle'))
  runtime = await startLocalRuntime({ port: 0, dataDirectory, siteDirectory, apiFile })
}, 25_000)
afterAll(async () => {
  if (runtime) await runtime.close()
  if (directory) await rm(directory, { recursive: true, force: true })
}, 25_000)

it('serves only loopback-local assets and actual migrated route metadata', async () => {
  const health = await payload(await fetch(`${runtime.origin}/__local/health`))
  expect(health).toMatchObject({ environment: 'local', externalRequests: false, emailDelivery: 'local-mailbox-only', routes: 101 })
  expect(health.migrations.skipped).toHaveLength(1)
  const page = await fetch(`${runtime.origin}/jobs`)
  expect(page.status).toBe(200)
  expect(page.headers.get('Content-Security-Policy')).toContain("connect-src 'self'")
  expect(page.headers.get('Content-Security-Policy')).not.toMatch(/https:|upgrade-insecure/)
  expect(page.headers.get('Strict-Transport-Security')).toBeNull()
  expect(await page.text()).toContain('외부 발송 없음')
  expect((await fetch(`${runtime.origin}/_headers`)).status).toBe(404)
  expect((await fetch(`${runtime.origin}/missing.js`)).status).toBe(404)
  const unknown = await call('/not-a-route', { method: 'HEAD' })
  expect(unknown.status).toBe(404)
  expect(await unknown.text()).toBe('')
})

it('rejects hostile origins, DNS-rebinding hosts, unsafe paths and unauthorized operations', async () => {
  expect((await fetch(`${runtime.origin}/__local/mail`, { headers: { Origin: 'https://hostile.invalid' } })).status).toBe(403)
  expect((await call('/demo/login', json({ role: 'developer' }, { Origin: 'https://hostile.invalid', 'X-App-Request': '1' }))).status).toBe(403)
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(`${runtime.origin}/__local/mail`, { headers: { Host: 'hostile.invalid' } }, response => { response.resume(); resolve(response.statusCode) })
    request.on('error', reject); request.end()
  })
  expect(status).toBe(403)
  expect((await fetch(`${runtime.origin}/%2eenv`)).status).toBe(400)
  expect((await call('/postings', json({ title: 'unauthorized', description: 'blocked' }))).status).toBe(401)
  expect((await call('/application-self-service')).status).toBe(401)
})

it('runs signup, local verification, persistent login, password recovery and session revocation through HTTP', async () => {
  const email = 'account@example.invalid', originalPassword = password()
  const profile = { email, password: originalPassword, displayName: '로컬 가입 확인', role: 'candidate', remember: true }
  const signup = await payload(await call('/signup', json(profile)), 202)
  expect(signup.verificationRequired).toBe(true)
  expect((await call('/login', json(profile))).status).toBe(403)
  const proof = await freshToken(email, 'verify-email')
  const verified = await payload(await call('/account/verify-email', json({ token: proof, password: originalPassword })))
  expect(verified.emailVerified).toBe(true)
  const loginResponse = await call('/login', json(profile))
  expect(loginResponse.headers.get('Set-Cookie')).toBeNull()
  const loggedIn = await payload(loginResponse)
  expect(loggedIn.sessionPersistent).toBe(true)
  const identity = await payload(await call('/me', { headers: auth(loggedIn.sessionToken) }))
  expect(identity.user.email).toBe(email)
  await payload(await call('/account/forgot-password', json({ email })), 202)
  const reset = await freshToken(email, 'reset-password'), replacementPassword = password()
  await payload(await call('/account/reset-password', json({ token: reset, newPassword: replacementPassword })))
  const revoked = await payload(await call('/me', { headers: auth(loggedIn.sessionToken) }))
  expect(revoked.user).toBeNull()
  expect((await call('/login', json({ ...profile, password: replacementPassword }))).status).toBe(200)
  expect((await call('/account/reset-password', json({ token: reset, newPassword: password() }))).status).toBe(400)
}, 20_000)

it('runs recruiter posting, PDF submission, receipt recovery, inbox access, editing and withdrawal with real storage', async () => {
  const trial = await payload(await call('/demo/login', json({ role: 'developer' })))
  expect((await call('/admin/users', { headers: auth(trial.sessionToken) })).status).toBe(403)
  const posting = await payload(await call('/postings', json({ title: '로컬 채용 흐름 검증', description: '이 공고는 자동 검증 후 삭제되는 예시입니다.' }, auth(trial.sessionToken))), 201)
  expect((await call(`/jobs/${posting.id}`)).status).toBe(200)
  const email = 'applicant@example.invalid', operation = randomBytes(32).toString('hex')
  const data = form(email, operation)
  data.append('resume', new File([resume], 'resume.pdf', { type: 'application/pdf' }))
  const receipt = await payload(await call(`/jobs/${posting.id}/apply`, { method: 'POST', body: data }), 201)
  const recovered = await payload(await call('/application-receipt', json({ postingId: posting.id, operationToken: operation })))
  expect(recovered.applicationId === receipt.applicationId).toBe(true)
  const retry = await payload(await call(`/jobs/${posting.id}/apply`, { method: 'POST', body: data }))
  expect(retry.recovered).toBe(true)
  await payload(await call('/application-access/request', json({ email })))
  const proof = await freshToken(email, 'application-manage')
  const session = await payload(await call('/application-access/exchange', json({ token: proof })))
  const headers = access(session.token)
  const list = await payload(await call('/application-self-service', { headers }))
  expect(list.applications).toHaveLength(1)
  const path = `/application-self-service/${receipt.applicationId}`
  const detail = await payload(await call(path, { headers }))
  const document = await call(`${path}/doc/${detail.application.documents[0].id}`, { headers })
  expect(document.status).toBe(200)
  expect(await document.text()).toBe(resume)
  const edited = await payload(await call(path, { method: 'PATCH', headers, body: form(email, operation, 0, '수정된 로컬 지원자') }))
  expect(edited.application.revision).toBe(1)
  expect(edited.application.applicantName).toBe('수정된 로컬 지원자')
  expect((await call(path, { method: 'PATCH', headers, body: form(email, operation, 0) })).status).toBe(409)
  await payload(await call(`${path}/withdraw`, json({ revision: 1 }, headers)))
  const withdrawn = await payload(await call(path, { headers }))
  expect(withdrawn.application).toMatchObject({ status: 'withdrawn', canEdit: false, canWithdraw: false })
  expect((await call(path, { method: 'PATCH', headers, body: form(email, operation, 1) })).status).toBe(409)
}, 20_000)

it('renders the local mailbox without executing HTML or exposing it cross-site', async () => {
  await runtime.mailbox.send({ to: 'viewer@example.invalid', subject: '<script>alert(1)</script>', text: '<img src=x onerror=alert(1)>', html: '<script>alert(2)</script>' })
  const response = await fetch(`${runtime.origin}/__local/mail`)
  const text = await response.text()
  expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(text).not.toContain('<script>')
  expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
  expect(response.headers.get('Cache-Control')).toBe('no-store')
})

it('recovers keyed posting and room creation over HTTP without duplicate resources or changed-payload writes', async () => {
  const trial = await payload(await call('/demo/login', json({ role: 'developer' })))
  const headers = auth(trial.sessionToken)
  const postingRequest = { operationId: randomUUID(), title: 'HTTP 재시도 공고', description: '응답 유실 후 동일 요청 복구 검증' }
  const posting = await payload(await call('/postings', json(postingRequest, headers)), 201)
  const postingRetry = await payload(await call('/postings', json(postingRequest, headers)))
  expect(postingRetry.id === posting.id).toBe(true)
  expect(postingRetry.recovered).toBe(true)
  expect((await call('/postings', json({ ...postingRequest, title: '다른 내용' }, headers))).status).toBe(409)
  const roomRequest = { operationId: randomUUID(), title: 'HTTP 재시도 면접방' }
  const room = await payload(await call('/rooms/create', json(roomRequest, headers)), 201)
  const roomRetry = await payload(await call('/rooms/create', json(roomRequest, headers)))
  expect(roomRetry.id === room.id).toBe(true)
  expect(roomRetry.recovered).toBe(true)
  const postings = await runtime.database.db.prepare('SELECT count(*) AS n FROM job_postings WHERE created_by_user_id = ?')
    .bind(trial.id).first()
  const rooms = await runtime.database.db.prepare('SELECT count(*) AS n FROM interview_rooms WHERE company_user_id = ?')
    .bind(trial.id).first()
  expect(Number(postings.n)).toBe(1)
  expect(Number(rooms.n)).toBe(1)
})

it('contains no provider network implementation in the offline API bundle', async () => {
  const bundle = await readFile(apiFile, 'utf8')
  expect(bundle).toContain('External requests are disabled in the local runtime')
  expect(bundle).not.toContain('oauth2.googleapis.com/token')
  expect(bundle).not.toContain('stun:stun.l.google.com')
  expect(bundle).not.toMatch(/\bfetch\(/)
})

it('removes speculative network hints before HTML bundling without modifying scripts', () => {
  const script = '<script>window.example = 1</script>'
  const html = offlineHtml(`<link rel="preconnect" href="https://remote.invalid"><link href="//remote.invalid" rel='DNS-PREFETCH'>${script}<link rel="preload" href="/font.woff2">`)
  expect(html).not.toContain('remote.invalid')
  expect(html).toContain(script)
  expect(html).toContain('rel="preload"')
})

it('archives a disposable completed-contract fixture through the actual PostgreSQL and file adapters', async () => {
  const db = runtime.database.db
  const owner = await db.prepare('SELECT id FROM users LIMIT 1').first()
  await db.prepare("INSERT INTO interview_rooms (id,company_user_id,title,invite_code,status) VALUES ('archive-fixture',?,'Local fixture','LOCALARCHIVE','signed')").bind(owner.id).run()
  await db.prepare("INSERT INTO contract_terms (room_id,employer_name,employee_name) VALUES ('archive-fixture','Local fixture employer','Local fixture employee')").run()
  const result = await archiveContract(runtime.env, 'archive-fixture')
  expect(result.ok).toBe(true)
  const record = await db.prepare("SELECT document_key,document_bytes FROM contract_archive WHERE room_id='archive-fixture'").first()
  const stored = await runtime.env.DOCUMENTS.get(record.document_key)
  expect(stored.httpMetadata.contentType).toBe('text/html; charset=utf-8')
  const bytes = await new Response(stored.body).arrayBuffer()
  expect(bytes.byteLength).toBe(Number(record.document_bytes))
  expect(new TextDecoder().decode(bytes)).toContain('Local fixture employee')
})

it('prevents two runtimes using one DB, then preserves real application data after restart', async () => {
  await expect(startLocalRuntime({ port: 0, dataDirectory, siteDirectory, apiFile })).rejects.toThrow('already in use')
  const before = await runtime.database.db.prepare('SELECT count(*) AS n FROM applications').first()
  expect(Number(before.n)).toBe(1)
  await runtime.close(); runtime = null
  runtime = await startLocalRuntime({ port: 0, dataDirectory, siteDirectory, apiFile })
  const after = await runtime.database.db.prepare('SELECT count(*) AS n FROM applications').first()
  expect(Number(after.n)).toBe(1)
  expect(runtime.database.migrations.applied).toHaveLength(0)
  expect((await runtime.mailbox.list()).length).toBeGreaterThan(0)
}, 20_000)
