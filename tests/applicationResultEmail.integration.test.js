import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestPost as passApplication } from '../server/api/applications/[id]/pass.js'
import { onRequestPost as rejectApplication } from '../server/api/applications/[id]/reject.js'
import { onRequestPost as retryResultEmail } from '../server/api/applications/[id]/send-result-email.js'
import { onRequestPost as sendCode } from '../server/api/applications/[id]/send-code.js'
import { onRequestGet as readApplication } from '../server/api/applications/[id]/index.js'
import { getApplicationResultEmail, sendApplicationResultNotification } from '../server/_lib/applicationResultEmail.js'

let db, env, owner, admin, other, candidate, network

beforeEach(() => {
  db = sqliteApp()
  owner = seedUser(db, 'owner', 'company', { recruiter: 1 })
  admin = seedUser(db, 'admin', 'company', { admin: 1 })
  other = seedUser(db, 'other', 'company', { recruiter: 1 })
  candidate = seedUser(db, 'candidate')
  db.sql.exec("UPDATE users SET company_name = '공고 소유 회사' WHERE id = 'owner'")
  owner.company_name = '공고 소유 회사'
  db.sql.prepare(`INSERT INTO job_postings (id, created_by_user_id, title, description)
    VALUES ('posting', 'owner', ?, '채용 공고 상세')`).run('운영 담당자 채용')
  db.sql.prepare(`INSERT INTO applications (
    id, posting_id, applicant_name, applicant_email, applicant_phone,
    created_user_id, cover_letter, ai_screening_json, consent_required
  ) VALUES ('application', 'posting', '지원자 이름', ?, '010-0000-0000', 'candidate', ?, ?, 1)`)
    .run(candidate.email, '지원서 본문 비공개', JSON.stringify({ summary: '내부 평가 비공개', score: 42 }))
  env = {
    DB: db, EMAIL_ENABLED: '1', GMAIL_CLIENT_ID: 'fixture', GMAIL_CLIENT_SECRET: 'fixture',
    GMAIL_REFRESH_TOKEN: 'fixture', FINAL_OFFER_FROM_EMAIL: 'sender@example.invalid',
  }
  network = vi.fn(async (url) => Response.json(String(url).includes('oauth2')
    ? { access_token: 'fixture' } : { id: 'fixture-receipt' }))
  // Every provider request is intercepted; these tests never send a real email.
  vi.stubGlobal('fetch', network)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  db.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const context = (user = owner, body = {}, id = 'application') => ({
  env, data: { user }, params: { id },
  request: new Request(`https://test.invalid/api/applications/${id}/send-result-email`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }),
})
const application = () => db.sql.prepare("SELECT * FROM applications WHERE id = 'application'").get()
const providerCalls = () => network.mock.calls.filter(([url]) => String(url).includes('/messages/send'))

function emailParts(index = 0) {
  const [, request] = providerCalls()[index]
  const mime = Buffer.from(JSON.parse(request.body).raw, 'base64url').toString('utf8')
  const part = (type) => {
    const pattern = new RegExp(`Content-Type: text/${type}; charset=UTF-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`)
    return Buffer.from(mime.match(pattern)?.[1] || '', 'base64').toString('utf8')
  }
  return { mime, text: part('plain'), html: part('html') }
}

function reviewed(status = 'rejected', emailStatus = 'pending') {
  if (status === 'passed') {
    db.sql.exec(`INSERT INTO interview_rooms (id, company_user_id, title, status, invite_code)
      VALUES ('room', 'owner', '면접방', 'active', 'ABCD2345EFGH')`)
  }
  db.sql.prepare(`UPDATE applications SET status = ?, result_email_status = ?,
    reviewed_at = datetime('now'), room_id = ? WHERE id = 'application'`)
    .run(status, emailStatus, status === 'passed' ? 'room' : null)
}

describe('automatic document screening result emails', () => {
  it.each([
    ['passed', passApplication, 201], ['rejected', rejectApplication, 200],
  ])('sends and persists a %s result once when the reviewer confirms it', async (status, decide, httpStatus) => {
    const response = await decide(context())
    const body = await response.json()
    expect(response.status).toBe(httpStatus)
    expect(body).toMatchObject({ ok: true, status, emailStatus: 'sent', resultEmail: { status: 'sent', canRetry: false } })
    expect(application()).toMatchObject({ status, result_email_status: 'sent', reviewed_by_user_id: owner.id })
    expect(application().result_email_attempted_at).toEqual(expect.any(String))
    expect(application().result_email_sent_at).toEqual(expect.any(String))
    expect(providerCalls()).toHaveLength(1)
    expect((await decide(context())).status).toBe(409)
    expect(providerCalls()).toHaveLength(1)
    const detail = await (await readApplication(context())).json()
    expect(detail.application.resultEmail).toEqual(body.resultEmail)
  })

  it.each([
    ['passed', passApplication], ['rejected', rejectApplication],
  ])('renders the %s HTML table using the posting owner, not the acting administrator', async (status, decide) => {
    const response = await decide(context(admin))
    expect(response.status).toBe(status === 'passed' ? 201 : 200)
    const { mime, html, text } = emailParts()
    expect(mime).toContain(`To: <${candidate.email}>`)
    expect(html).toContain('<table')
    for (const value of ['공고 소유 회사', '운영 담당자 채용', '지원자 이름', status === 'passed' ? '합격' : '불합격']) {
      expect(html).toContain(value)
    }
    expect(text).toContain('운영 담당자 채용')
    expect(html).not.toContain('내부 평가 비공개')
    expect(text).not.toContain('내부 평가 비공개')
    expect(html).not.toContain('지원서 본문 비공개')
    expect(html).not.toContain('최종 합격')
    if (status === 'passed') {
      expect(html).toContain('면접방 입장 코드')
      expect(html).toContain('href="https://portfolio-epa.pages.dev/jobs"')
    } else {
      expect(html).not.toContain('면접방 입장 코드')
    }
  })

  it('escapes applicant and posting data in the outgoing HTML', async () => {
    db.sql.prepare("UPDATE applications SET applicant_name = ? WHERE id = 'application'").run('<script>applicant</script>')
    db.sql.prepare("UPDATE job_postings SET title = ? WHERE id = 'posting'").run('<img src=x onerror=alert(1)>')
    await rejectApplication(context())
    const { html } = emailParts()
    expect(html).toContain('&lt;script&gt;applicant&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toMatch(/<script>|<img src=x/)
  })

  it.each([
    ['passed', passApplication], ['rejected', rejectApplication],
  ])('keeps the %s decision when Gmail is disabled and safely sends after configuration', async (status, decide) => {
    env.EMAIL_ENABLED = '0'
    const body = await (await decide(context())).json()
    expect(body).toMatchObject({ status, emailStatus: 'not_sent', resultEmail: { status: 'not_sent', canRetry: true } })
    expect(application().status).toBe(status)
    expect(application().result_email_status).toBe('not_sent')
    expect(network).not.toHaveBeenCalled()
    env.EMAIL_ENABLED = '1'
    const retry = await (await retryResultEmail(context())).json()
    expect(retry).toMatchObject({ ok: true, emailStatus: 'sent', resultEmail: { status: 'sent', canRetry: false } })
    expect(providerCalls()).toHaveLength(1)
    expect(application().status).toBe(status)
  })

  it('records missing credentials as not sent without calling the provider', async () => {
    delete env.GMAIL_REFRESH_TOKEN
    const body = await (await rejectApplication(context())).json()
    expect(body.emailStatus).toBe('not_sent')
    expect(application().result_email_status).toBe('not_sent')
    expect(network).not.toHaveBeenCalled()
  })

  it.each([
    ['pass/pass', passApplication, passApplication],
    ['reject/reject', rejectApplication, rejectApplication],
    ['pass/reject', passApplication, rejectApplication],
  ])('commits only one decision and one email for concurrent %s requests', async (_name, first, second) => {
    const responses = await Promise.all([first(context()), second(context())])
    expect(responses.filter((response) => response.ok)).toHaveLength(1)
    expect(responses.filter((response) => response.status === 409)).toHaveLength(1)
    expect(providerCalls()).toHaveLength(1)
    expect(application().result_email_status).toBe('sent')
    expect(db.sql.prepare('SELECT count(*) AS count FROM interview_rooms').get().count)
      .toBe(application().status === 'passed' ? 1 : 0)
  })
})

describe('safe result email retries', () => {
  it.each(['pending', 'not_sent', 'failed'])('can retry a known-safe %s state', async (status) => {
    reviewed('rejected', status)
    const response = await retryResultEmail(context())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, emailStatus: 'sent', resultEmail: { status: 'sent', canRetry: false } })
    expect(providerCalls()).toHaveLength(1)
  })

  it('retries a definite provider rejection without repeating the screening decision', async () => {
    network.mockResolvedValueOnce(Response.json({ error: 'invalid_grant' }, { status: 400 }))
    const first = await (await rejectApplication(context())).json()
    expect(first).toMatchObject({ status: 'rejected', emailStatus: 'failed', resultEmail: { canRetry: true } })
    expect(application().result_email_status).toBe('failed')
    expect(providerCalls()).toHaveLength(0)
    const originalReviewTime = application().reviewed_at
    const retry = await (await retryResultEmail(context())).json()
    expect(retry).toMatchObject({ ok: true, emailStatus: 'sent' })
    expect(providerCalls()).toHaveLength(1)
    expect(application().reviewed_at).toBe(originalReviewTime)
  })

  it.each([400, 403, 429])('allows retry after a definite Gmail send rejection (%s)', async (status) => {
    network.mockResolvedValueOnce(Response.json({ access_token: 'fixture' }))
      .mockResolvedValueOnce(Response.json({}, { status }))
    const first = await (await rejectApplication(context())).json()
    expect(first.resultEmail).toMatchObject({ status: 'failed', canRetry: true })
    expect((await (await retryResultEmail(context())).json()).emailStatus).toBe('sent')
    expect(providerCalls()).toHaveLength(2)
  })

  it('releases the retry cooldown when configuration is missing', async () => {
    reviewed('rejected', 'failed')
    env.EMAIL_ENABLED = '0'
    const first = await (await retryResultEmail(context())).json()
    expect(first).toMatchObject({ ok: false, emailStatus: 'not_sent', resultEmail: { canRetry: true } })
    expect(network).not.toHaveBeenCalled()
    env.EMAIL_ENABLED = '1'
    const second = await retryResultEmail(context())
    expect(second.status).toBe(200)
    expect((await second.json()).emailStatus).toBe('sent')
    expect(providerCalls()).toHaveLength(1)
  })

  it.each(['timeout', 'server_error', 'missing_receipt'])('does not retry an ambiguous provider outcome: %s', async (failure) => {
    network.mockResolvedValueOnce(Response.json({ access_token: 'fixture' }))
    if (failure === 'timeout') network.mockRejectedValueOnce(new Error('provider timeout'))
    if (failure === 'server_error') network.mockResolvedValueOnce(Response.json({}, { status: 503 }))
    if (failure === 'missing_receipt') network.mockResolvedValueOnce(Response.json({}))
    const body = await (await rejectApplication(context())).json()
    expect(body).toMatchObject({ status: 'rejected', emailStatus: 'unknown', resultEmail: { status: 'unknown', canRetry: false } })
    expect(application().result_email_status).toBe('unknown')
    expect((await retryResultEmail(context())).status).toBe(409)
    expect(providerCalls()).toHaveLength(1)
  })

  it.each(['sent', 'unknown', 'sending', null])('refuses %s status after an owner rename or a different administrator request', async (status) => {
    reviewed('rejected', status)
    db.sql.exec("UPDATE users SET company_name = '이름을 바꾼 회사' WHERE id = 'owner'")
    expect((await retryResultEmail(context(owner))).status).toBe(409)
    expect((await retryResultEmail(context(admin))).status).toBe(409)
    expect(network).not.toHaveBeenCalled()
    expect(getApplicationResultEmail(application())).toMatchObject({
      status: status === null ? 'legacy_unknown' : status, canRetry: false,
    })
  })

  it('atomically claims concurrent retries before contacting Gmail', async () => {
    reviewed('rejected', 'failed')
    let allowProviderResponse, providerStarted
    const heldResponse = new Promise((resolve) => { allowProviderResponse = resolve })
    const started = new Promise((resolve) => { providerStarted = resolve })
    network.mockImplementation(async (url) => {
      if (String(url).includes('oauth2')) return Response.json({ access_token: 'fixture' })
      providerStarted()
      return heldResponse
    })
    const first = retryResultEmail(context())
    await started
    const second = await retryResultEmail(context(admin))
    expect(second.status).toBe(409)
    expect(application().result_email_status).toBe('sending')
    allowProviderResponse(Response.json({ id: 'fixture-receipt' }))
    expect((await first).status).toBe(200)
    expect(providerCalls()).toHaveLength(1)
    expect(application().result_email_status).toBe('sent')
  })

  it('uses a stable application-level claim even if content changes after a completed send', async () => {
    await rejectApplication(context())
    db.sql.exec("UPDATE job_postings SET title = '변경된 제목' WHERE id = 'posting'")
    const state = await sendApplicationResultNotification(env, 'application')
    expect(state).toMatchObject({ status: 'sent', canRetry: false })
    expect(providerCalls()).toHaveLength(1)
  })

  it('does not send again when persisting provider acceptance fails', async () => {
    reviewed('rejected', 'pending')
    const prepare = db.prepare.bind(db)
    db.prepare = (source) => {
      const statement = prepare(source)
      if (/UPDATE\s+applications/i.test(source) && source.includes('result_email_status')) {
        const run = statement.run.bind(statement)
        statement.run = async () => {
          if (/result_email_status\s*=\s*'sent'/.test(source) || statement.values.includes('sent')) {
            throw new Error('database unavailable after provider acceptance')
          }
          return run()
        }
      }
      return statement
    }
    const state = await sendApplicationResultNotification(env, 'application')
    expect(state.status).toMatch(/unknown|sending/)
    expect(state.canRetry).toBe(false)
    expect(['unknown', 'sending']).toContain(application().result_email_status)
    expect((await retryResultEmail(context())).status).toBe(409)
    expect(providerCalls()).toHaveLength(1)
  })

  it('keeps the screening decision and blocks retries if the underlying outbox cannot persist acceptance', async () => {
    const prepare = db.prepare.bind(db)
    db.prepare = (source) => {
      const statement = prepare(source)
      if (source.includes("UPDATE email_outbox SET status = 'accepted'")) {
        statement.run = async () => { throw new Error('outbox unavailable after acceptance') }
      }
      return statement
    }
    const response = await rejectApplication(context())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'rejected', emailStatus: 'unknown', resultEmail: { canRetry: false },
    })
    expect(application().status).toBe('rejected')
    expect((await retryResultEmail(context())).status).toBe(409)
    expect(providerCalls()).toHaveLength(1)
  })

  it.each(['sent', 'unknown', 'sending', null])('the legacy send-code endpoint cannot bypass a %s application claim', async (status) => {
    reviewed('passed', status)
    expect((await sendCode(context())).status).toBe(409)
    expect(network).not.toHaveBeenCalled()
  })

  it('routes a safe legacy send-code retry through the shared result state machine', async () => {
    reviewed('passed', 'failed')
    const response = await sendCode(context())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, emailStatus: 'sent', resultEmail: { status: 'sent' } })
    expect(application().result_email_status).toBe('sent')
    expect((await retryResultEmail(context())).status).toBe(409)
    expect(providerCalls()).toHaveLength(1)
  })

  it.each([
    ['missing_configuration', 'not_sent', 503],
    ['definite_provider_failure', 'failed', 502],
  ])('legacy clients receive an HTTP error for %s and can safely retry later', async (failure, state, status) => {
    reviewed('passed', 'failed')
    if (failure === 'missing_configuration') env.EMAIL_ENABLED = '0'
    else network.mockResolvedValueOnce(Response.json({ error: 'invalid_grant' }, { status: 400 }))
    const failed = await sendCode(context())
    const body = await failed.json()
    expect(failed.status).toBe(status)
    expect(failed.ok).toBe(false)
    expect(body).toMatchObject({ ok: false, emailStatus: state, resultEmail: { status: state, canRetry: true } })
    expect(body.error).toBe(body.resultEmail.message)
    expect(application().result_email_status).toBe(state)
    expect(providerCalls()).toHaveLength(0)

    env.EMAIL_ENABLED = '1'
    const success = await sendCode(context())
    expect(success.status).toBe(200)
    expect(await success.json()).toMatchObject({ ok: true, emailStatus: 'sent', resultEmail: { canRetry: false } })
    expect(providerCalls()).toHaveLength(1)
  })

  it.each(['timeout', 'server_error'])('legacy clients receive HTTP 409 for an uncertain %s and cannot send again', async (failure) => {
    reviewed('passed', 'failed')
    network.mockResolvedValueOnce(Response.json({ access_token: 'fixture' }))
    if (failure === 'timeout') network.mockRejectedValueOnce(new Error('provider timeout'))
    else network.mockResolvedValueOnce(Response.json({}, { status: 503 }))
    const response = await sendCode(context())
    const body = await response.json()
    expect(response.status).toBe(409)
    expect(response.ok).toBe(false)
    expect(body).toMatchObject({ ok: false, emailStatus: 'unknown', resultEmail: { status: 'unknown', canRetry: false } })
    expect(body.error).toBe(body.resultEmail.message)
    expect(application().result_email_status).toBe('unknown')
    expect((await sendCode(context())).status).toBe(409)
    expect(providerCalls()).toHaveLength(1)
  })
})

describe('result notification boundaries', () => {
  it.each([
    ['anonymous', 401], ['candidate', 403], ['other', 403], ['trial_admin', 403],
  ])('denies %s before provider or application mutations', async (kind, status) => {
    reviewed('rejected', 'failed')
    const users = { anonymous: null, candidate, other, trial_admin: { ...admin, developer_trial: 1 } }
    expect((await retryResultEmail(context(users[kind]))).status).toBe(status)
    expect(application().result_email_status).toBe('failed')
    expect(network).not.toHaveBeenCalled()
  })

  it('does not send for a submitted application or a nonexistent application', async () => {
    expect((await retryResultEmail(context())).status).toBe(409)
    expect((await retryResultEmail(context(owner, {}, 'missing'))).status).toBe(404)
    expect(network).not.toHaveBeenCalled()
  })

  it('ignores recipient and result overrides from the request body', async () => {
    reviewed('rejected', 'failed')
    const response = await retryResultEmail(context(owner, {
      to: 'intruder@example.invalid', applicantEmail: 'intruder@example.invalid',
      result: 'passed', companyName: '위조 회사', inviteCode: 'OVERRIDE',
    }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.sentTo).not.toBe(candidate.email)
    const { mime, text, html } = emailParts()
    expect(mime).toContain(`To: <${candidate.email}>`)
    expect(html).toContain('불합격')
    expect(text + html).not.toMatch(/intruder@example\.invalid|위조 회사|OVERRIDE/)
  })

  it('does not expose stored provider diagnostics or secrets in the public summary', () => {
    reviewed('rejected', 'failed')
    db.sql.prepare("UPDATE applications SET result_email_error = ? WHERE id = 'application'")
      .run('sensitive-fixture-provider-detail')
    const summary = getApplicationResultEmail(application())
    expect(summary).toMatchObject({ status: 'failed', canRetry: true })
    expect(JSON.stringify(summary)).not.toContain('sensitive-fixture-provider-detail')
  })
})
