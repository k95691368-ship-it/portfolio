// 외부 요청과 메일 발송을 차단한 격리 로컬 환경에서 계약 체결까지 검증한다.
//
// 스모크 테스트가 "경로가 살아 있는가"를 본다면, 여기서는 "흐름이 실제로
// 이어지는가"를 본다. 지금까지 이 과정을 손으로 돌려 확인해 왔는데,
// 합의로 바뀐 값을 불일치로 오인하던 결함처럼 끝까지 돌려봐야만 드러나는
// 문제가 실제로 있었다.
//
// 데이터를 만들기 때문에 끝나면 스스로 지운다(관리자 계정으로 방·계정 삭제).
// 전용 테스트 관리자 자격과 격리 상태 확인에 실패하면 쓰기 전에 중단한다.
//
// 실행:
//   E2E_API_BASE=http://127.0.0.1:5189/api E2E_ENVIRONMENT=test E2E_ALLOW_WRITES=1
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run e2e
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { e2ePolicy, e2eRequest, verifyE2eIsolation, readE2eVerificationToken } from '../scripts/e2e-policy.mjs'

const policy = e2ePolicy()
const BASE = policy.apiBase
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD
// 가입은 IP당 시간당 10회로 제한된다. 그 한도에 걸렸거나 계정을 새로 만들고
// 싶지 않을 때는 이미 있는 계정으로 돌릴 수 있게 한다. 이 경우 계정은 지우지
// 않고 이번 실행에서 만든 면접방만 정리한다.
const REUSE_COMPANY_EMAIL = process.env.E2E_COMPANY_EMAIL
const REUSE_COMPANY_PASSWORD = process.env.E2E_COMPANY_PASSWORD
const REUSE_CANDIDATE_EMAIL = process.env.E2E_CANDIDATE_EMAIL
const REUSE_CANDIDATE_PASSWORD = process.env.E2E_CANDIDATE_PASSWORD
const REUSE = Boolean(
  REUSE_COMPANY_EMAIL && REUSE_COMPANY_PASSWORD && REUSE_CANDIDATE_EMAIL && REUSE_CANDIDATE_PASSWORD
)
const RUN = `e2e${Date.now().toString(36)}`
const PASSWORD = 'e2e-test-password-2026'
const dateOnly = date => date.toISOString().slice(0, 10)
const dayOffset = (value, days) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return dateOnly(date) }
const yearOffset = (value, years) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCFullYear(date.getUTCFullYear() + years); return dateOnly(date) }
const TODAY = dateOnly(new Date())
const START = dayOffset(TODAY, -30)
const END = yearOffset(TODAY, 1)
const ENDED_ON = dayOffset(TODAY, -1)

// 쿠키를 직접 들고 다닌다 (fetch에는 쿠키 저장소가 없다).
function makeClient() {
  let sessionToken = ''
  const roomTokens = new Map()
  return async function call(path, { method = 'GET', body, raw } = {}) {
    const headers = { 'X-App-Request': '1' }
    if (process.env.E2E_PUBLISHABLE_KEY) headers.apikey = process.env.E2E_PUBLISHABLE_KEY
    if (sessionToken) headers['X-App-Authorization'] = `Bearer ${sessionToken}`
    const room = path.match(/^\/api\/rooms\/([^/]+)\//)?.[1]
    if (room && roomTokens.has(room)) {
      headers['X-Room-Authorization'] = `Bearer ${roomTokens.get(room)}`
      headers['X-Room-Identity'] = 'code'
    }
    if (body && !raw) headers['Content-Type'] = 'application/json'
    const res = await e2eRequest(policy, path, {
      method,
      headers,
      body: raw ? body : body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 라우트가 없으면 HTML이 온다 */
    }
    if (json?.sessionToken) sessionToken = json.sessionToken
    if (json?.roomSessionToken && json.roomId) roomTokens.set(json.roomId, json.roomSessionToken)
    if (path === '/api/logout' && res.ok) sessionToken = ''
    return { status: res.status, json, text }
  }
}

const company = makeClient()
const candidate = makeClient()
const admin = makeClient()

const state = {
  roomId: null,
  renewalRoomId: null,
  duplicateRoomId: null,
  companyId: null,
  candidateId: null,
  requestId: null,
}
const hasAdmin = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD)
if (!hasAdmin) throw new Error('Dedicated test administrator credentials are required; this suite must not silently skip.')

describe.skipIf(!hasAdmin)(`격리 HTTP 계약 경로 (${BASE})`, () => {
  beforeAll(async () => {
    await verifyE2eIsolation(policy)
    const res = await admin('/api/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    expect(res.status, '관리자 로그인에 실패했습니다. 자격 증명을 확인하세요.').toBe(200)

    if (REUSE) {
      const c = await company('/api/login', {
        method: 'POST',
        body: { email: REUSE_COMPANY_EMAIL, password: REUSE_COMPANY_PASSWORD },
      })
      expect(c.status, `회사 계정 로그인 실패: ${c.text}`).toBe(200)
      expect(c.json.role, '회사 역할 계정이어야 면접방을 만들 수 있습니다.').toBe('company')
      state.companyId = c.json.id

      const k = await candidate('/api/login', {
        method: 'POST',
        body: { email: REUSE_CANDIDATE_EMAIL, password: REUSE_CANDIDATE_PASSWORD },
      })
      expect(k.status, `지원자 계정 로그인 실패: ${k.text}`).toBe(200)
      state.candidateId = k.json.id
      return
    }

    // 계정 생성은 여기서 끝낸다. 가입 제한에 걸리면 이후 검사가 줄줄이
    // 실패해 원인이 묻히므로, 한 줄로 분명히 알린다.
    const c = await company('/api/signup', {
      method: 'POST',
      body: {
        email: `${RUN}-co@example.invalid`,
        password: PASSWORD,
        role: 'company',
        displayName: 'E2E회사',
        companyName: 'E2E회사',
      },
    })
    if (c.status === 429) {
      throw new Error(
        '가입 요청 제한(시간당 10회)에 걸렸습니다. 앱은 정상이며, 잠시 후 다시 실행하세요.'
      )
    }
    expect(c.status, '회사 가입 요청 상태').toBe(202)
    expect(c.json.verificationRequired).toBe(true)
    const companyProof = await readE2eVerificationToken(policy, `${RUN}-co@example.invalid`)
    const verifiedCompany = await company('/api/account/verify-email', {
      method: 'POST', body: { token: companyProof, password: PASSWORD },
    })
    expect(verifiedCompany.status, '로컬 회사 이메일 확인 상태').toBe(200)
    expect(verifiedCompany.json.emailVerified).toBe(true)
    state.companyId = verifiedCompany.json.id

    const k = await candidate('/api/signup', {
      method: 'POST',
      body: {
        email: `${RUN}-ca@example.invalid`,
        password: PASSWORD,
        role: 'candidate',
        displayName: 'E2E지원자',
      },
    })
    expect(k.status, '지원자 가입 요청 상태').toBe(202)
    expect(k.json.verificationRequired).toBe(true)
    const candidateProof = await readE2eVerificationToken(policy, `${RUN}-ca@example.invalid`)
    const verifiedCandidate = await candidate('/api/account/verify-email', {
      method: 'POST', body: { token: candidateProof, password: PASSWORD },
    })
    expect(verifiedCandidate.status, '로컬 지원자 이메일 확인 상태').toBe(200)
    expect(verifiedCandidate.json.emailVerified).toBe(true)
    state.candidateId = verifiedCandidate.json.id
  })

  afterAll(async () => {
    // 만든 것은 반드시 지운다. 실패해도 다음 정리를 계속 시도한다.
    // 갱신 계약이 이전 계약을 참조하므로 갱신 쪽을 먼저 지운다.
    // 체결된 계약서는 보존 의무(근로기준법 제42조)로 삭제가 한 번 막힌다.
    // 검증용 데이터이므로 확인을 함께 보낸다 — 이 사실은 감사 로그에 남는다.
    const failures = []
    for (const id of [state.duplicateRoomId, state.renewalRoomId, state.roomId]) {
      if (id) {
        try {
          const result = await admin(`/api/admin/rooms/${id}`, {
            method: 'DELETE',
            body: { acknowledgeRetention: true },
          })
          if (result.status !== 200) failures.push(`room:${result.status}`)
        } catch { failures.push('room:transport') }
      }
    }
    // 빌려 쓴 계정은 지우지 않는다. 이번 실행에서 만든 계정만 정리한다.
    if (!REUSE) {
      for (const id of [state.candidateId, state.companyId]) {
        if (id) {
          try {
            const result = await admin(`/api/admin/users/${id}`, { method: 'DELETE' })
            if (result.status !== 200) failures.push(`user:${result.status}`)
          } catch { failures.push('user:transport') }
        }
      }
    }
    if (failures.length) throw new Error(`Isolated fixture cleanup failed: ${failures.join(', ')}`)
  }, 20_000)

  it('면접방을 만들고 지원자가 참여한다', async () => {
    const room = await company('/api/rooms/create', {
      method: 'POST',
      body: { title: `E2E 검증 ${RUN}` },
    })
    expect(room.status).toBe(201)
    state.roomId = room.json.id

    const join = await candidate('/api/rooms/join', {
      method: 'POST',
      body: { inviteCode: room.json.inviteCode },
    })
    expect(join.status).toBe(200)
  })

  it('면접방에서 대화를 주고받는다', async () => {
    const sent = await company(`/api/rooms/${state.roomId}/messages`, {
      method: 'POST',
      body: { body: '안녕하세요. 근무지는 서울 본사입니다.' },
    })
    expect(sent.status).toBe(201)

    const seen = await candidate(`/api/rooms/${state.roomId}/messages?after=0`)
    expect(seen.status).toBe(200)
    expect(seen.json.messages.length).toBeGreaterThan(0)
  })

  it('회사만 계약 조건을 작성할 수 있다', async () => {
    const denied = await candidate(`/api/rooms/${state.roomId}/contract`, {
      method: 'PATCH',
      body: { wageBaseAmount: 1 },
    })
    expect(denied.status).toBe(403)

    const ok = await company(`/api/rooms/${state.roomId}/contract`, {
      method: 'PATCH',
      body: {
        employerName: 'E2E회사',
        employeeName: 'E2E지원자',
        workLocation: '서울 본사',
        jobDescription: '개발',
        contractStartDate: START,
        contractEndDate: END,
        workHoursStart: '09:00',
        workHoursEnd: '18:00',
        breakTime: '12:00~13:00',
        employeeCount: 10,
        workDays: '주 5일 (월~금)',
        restDays: '토요일, 일요일',
        wageBaseAmount: 1700000, // 최저임금 미달 — 점검이 잡아야 한다
        wagePayMethod: '근로자 명의 예금통장 입금',
        wagePayDate: '매월 25일',
        annualLeave: '근로기준법에 따름',
      },
    })
    expect(ok.status).toBe(200)
  })

  it('서명 전 점검이 최저임금 미달을 잡고 적법한 금액을 제안한다', async () => {
    const view = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    expect(view.status).toBe(200)

    const issue = view.json.preSignCheck.legalIssues.find((i) => i.field === 'wageBaseAmount')
    expect(issue, '최저임금 미달을 잡지 못했습니다.').toBeTruthy()
    expect(issue.severity).toBe('high')
    expect(Number(issue.suggestedValue)).toBeGreaterThan(1700000)
    state.suggested = issue.suggestedValue
  })

  it('근로자에게 계약을 해설해 준다', async () => {
    // 최저임금 미달 상태(기본급 170만원 · 주 40시간)에서 근로자가 보는 해설
    const view = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    const explanation = view.json.explanation
    expect(explanation, '계약 해설이 없습니다.').toBeTruthy()

    const wage = explanation.sections.find((s) => s.title === '임금')
    const hourly = wage.lines.find((l) => l.label === '시급 환산')
    // 계약서에는 월급만 적혀 있는데, 근로자가 알아야 하는 것은 시급이다.
    expect(hourly.value).toMatch(/원$/)
    expect(hourly.note).toContain('주휴시간 포함')

    const compare = wage.lines.find((l) => l.label === '최저임금 비교')
    expect(compare.tone).toBe('caution')
    expect(compare.value).toContain('미달')
    expect(compare.note).toContain('최소')

    // 하루 실근로시간은 휴게시간을 뺀 값이어야 한다 (09:00~18:00 → 8시간)
    const hoursSection = explanation.sections.find((s) => s.title === '근로시간')
    expect(hoursSection.lines.find((l) => l.label === '하루 근로시간').value).toBe('8시간')

    // 서명 전 확인 목록에 교부 안내가 들어 있다
    const checklist = explanation.sections.find((s) => s.title === '서명 전에 확인할 것')
    expect(checklist.lines.some((l) => l.value.includes('교부'))).toBe(true)
    expect(explanation.cautionCount).toBeGreaterThan(0)
  })

  it('지원자가 제안 금액으로 수정을 요청한다', async () => {
    const req = await candidate(`/api/rooms/${state.roomId}/change-requests`, {
      method: 'POST',
      body: {
        field: 'wageBaseAmount',
        requestedValue: state.suggested,
        reason: '최저임금 미달로 조정 요청',
      },
    })
    expect(req.status, `수정 요청 실패: ${req.text}`).toBe(201)
    state.requestId = req.json.id

    // 회사는 직접 고칠 수 있으므로 요청 대상이 아니다.
    const wrongSide = await company(`/api/rooms/${state.roomId}/change-requests`, {
      method: 'POST',
      body: { field: 'workLocation', requestedValue: '부산' },
    })
    expect(wrongSide.status).toBe(403)
  })

  it('회사가 수락하면 계약서에 반영되고 위반이 해소된다', async () => {
    const denied = await candidate(
      `/api/rooms/${state.roomId}/change-requests/${state.requestId}`,
      { method: 'POST', body: { action: 'accept' } }
    )
    expect(denied.status).toBe(403)

    const accepted = await company(
      `/api/rooms/${state.roomId}/change-requests/${state.requestId}`,
      { method: 'POST', body: { action: 'accept' } }
    )
    expect(accepted.status, `수락 실패: ${accepted.text}`).toBe(200)

    const view = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    expect(Number(view.json.contract.terms.wageBaseAmount)).toBe(Number(state.suggested))
    expect(view.json.preSignCheck.legalIssues).toHaveLength(0)
    // 본인이 요청해 합의된 값이므로 불일치로 잡히면 안 된다.
    expect(view.json.preSignCheck.diffs).toHaveLength(0)
    expect(view.json.preSignCheck.hasBlocking).toBe(false)
  })

  it('합의 후 회사가 일방적으로 바꾸면 다시 잡아낸다', async () => {
    await company(`/api/rooms/${state.roomId}/contract`, {
      method: 'PATCH',
      body: { wageBaseAmount: 1900000 },
    })
    const view = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    expect(view.json.preSignCheck.diffs.length).toBeGreaterThan(0)
    expect(view.json.preSignCheck.hasBlocking).toBe(true)

    // 원래 합의 값으로 되돌려 서명 단계로 넘어간다.
    await company(`/api/rooms/${state.roomId}/contract`, {
      method: 'PATCH',
      body: { wageBaseAmount: Number(state.suggested) },
    })
  })

  it('회사가 채용을 확정하면 서명 단계로 넘어간다', async () => {
    // 확정 전에는 서명할 수 없다.
    const tooEarly = await company(`/api/rooms/${state.roomId}/sign`, {
      method: 'POST',
      body: { imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
    })
    expect(tooEarly.status).toBe(400)

    const denied = await candidate(`/api/rooms/${state.roomId}/confirm-hire`, { method: 'POST' })
    expect(denied.status).toBe(403)

    const confirmed = await company(`/api/rooms/${state.roomId}/confirm-hire`, { method: 'POST' })
    expect(confirmed.status, `채용 확정 실패: ${confirmed.text}`).toBe(201)

    // 다시 눌러도 중복 처리되지 않는다.
    const again = await company(`/api/rooms/${state.roomId}/confirm-hire`, { method: 'POST' })
    expect(again.json.alreadyConfirmed).toBe(true)

    const view = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    expect(view.json.contract.hireConfirmed).toBe(true)
    expect(view.json.room.status).toBe('contract_pending')
  })

  it('외부 AI 없이도 현재 조건의 기본 조항과 조건 수정 흐름을 유지한다', async () => {
    // 계약서 본문은 채용자 권한이 있어야 작성할 수 있다.
    // 빌려 쓴 계정은 이미 권한을 갖고 있으므로 건드리지 않는다.
    if (!REUSE) {
      const granted = await admin(`/api/admin/users/${state.companyId}`, {
        method: 'PATCH',
        body: { isRecruiter: true },
      })
      expect(granted.status, `채용자 권한 부여 실패: ${granted.text}`).toBe(200)
    }

    const before = await company(`/api/rooms/${state.roomId}/contract-view`)
    const draft = await company(`/api/rooms/${state.roomId}/contract-draft`, {
      method: 'POST',
      body: before.json.contract.terms,
    })
    // This runtime deliberately has no provider credentials or outbound fetch.
    // Do not invent generated articles or enable external AI just for a green test.
    expect(draft.status, '외부 AI 차단 상태').toBe(502)

    // The existing non-AI document is derived from current saved conditions.
    // Stored-AI-body mismatch rejection is exercised by the actual sign handler
    // in contractSnapshot.engines.test.js with an explicit database fixture.
    const fresh = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    const doc = fresh.json.preSignCheck.documentCheck
    expect(fresh.json.contract.terms).toEqual(before.json.contract.terms)
    expect(fresh.json.contract.terms.aiDocument).toBeNull()
    expect(fresh.json.sourceArticles.length).toBeGreaterThan(0)
    expect(JSON.stringify(fresh.json.sourceArticles)).toContain(Number(state.suggested).toLocaleString('ko-KR'))
    expect(doc.hasDocument).toBe(false)
    expect(doc.issues.find((i) => i.field === 'wageBaseAmount')).toBeUndefined()

    // Updating structured conditions must update the fallback document too.
    const bumped = Number(state.suggested) + 500000
    await company(`/api/rooms/${state.roomId}/contract`, {
      method: 'PATCH',
      body: { wageBaseAmount: bumped },
    })

    const stale = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    expect(JSON.stringify(stale.json.sourceArticles)).toContain(bumped.toLocaleString('ko-KR'))
    expect(stale.json.preSignCheck.documentCheck.hasConflict).toBe(false)
    expect(stale.json.preSignCheck.hasBlocking).toBe(true)

    // 기존 기본급으로 되돌린 뒤 현재 기본 조항의 점검 상태를 확인한다.
    await company(`/api/rooms/${state.roomId}/contract`, {
      method: 'PATCH',
      body: { wageBaseAmount: Number(state.suggested) },
    })
    const fixed = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    expect(
      fixed.json.preSignCheck.documentCheck.issues.find((i) => i.field === 'wageBaseAmount')
    ).toBeUndefined()
  })

  it('필수 명시사항이 비면 서버가 서명을 막는다', async () => {
    const sig = 'data:image/png;base64,iVBORw0KGgo='
    // 임금 지급방법을 비운다 — 근로기준법 제17조 제1항 명시사항이다.
    await company(`/api/rooms/${state.roomId}/contract`, {
      method: 'PATCH',
      body: { wagePayMethod: '' },
    })
    const blocked = await company(`/api/rooms/${state.roomId}/sign`, {
      method: 'POST',
      body: { imageDataUrl: sig },
    })
    expect(blocked.status, `필수 항목이 비어도 서명이 통과했습니다: ${blocked.text}`).toBe(409)
    expect(blocked.json.error).toContain('제17조')

    // 다시 채우면 서명할 수 있다.
    await company(`/api/rooms/${state.roomId}/contract`, {
      method: 'PATCH',
      body: { wagePayMethod: '근로자 명의 예금통장 입금' },
    })
  })

  it('한쪽만 서명한 상태에서 내용이 바뀌면 그 서명은 무효가 된다', async () => {
    const sig =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

    // 지원자가 먼저 서명한다. 이 시점에는 방 상태가 아직 'signed'가 아니다.
    const first = await candidate(`/api/rooms/${state.roomId}/sign`, {
      method: 'POST',
      body: { imageDataUrl: sig },
    })
    expect(first.status, `지원자 서명 실패: ${first.text}`).toBe(200)
    expect(first.json.bothSigned).toBe(false)

    // 그 상태에서 회사가 조건을 바꾼다 — 예전에는 지원자 서명이 그대로 남아,
    // 지원자가 본 적 없는 조건에 지원자 서명이 붙은 계약이 만들어졌다.
    const changed = await company(`/api/rooms/${state.roomId}/contract`, {
      method: 'PATCH',
      body: { workLocation: '부산 지점' },
    })
    expect(changed.status).toBe(200)
    expect(changed.json.revokedSignatures, '서명이 무효화되지 않았습니다.').toBe(1)

    const view = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    expect(view.json.signatures).toHaveLength(0)
    expect(view.json.revokedSignatures.length).toBeGreaterThan(0)
    expect(view.json.revokedSignatures[0].role).toBe('candidate')
    expect(view.json.revokedSignatures[0].reason).toContain('workLocation')

    // 원래 값으로 되돌려 이후 검사에 영향을 주지 않는다.
    await company(`/api/rooms/${state.roomId}/contract`, {
      method: 'PATCH',
      body: { workLocation: '서울 본사' },
    })
  })

  it('양측이 서명하면 계약이 체결된다', async () => {
    const sig =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

    const first = await company(`/api/rooms/${state.roomId}/sign`, {
      method: 'POST',
      body: { imageDataUrl: sig },
    })
    expect(first.status, `회사 서명 실패: ${first.text}`).toBe(200)
    expect(first.json.bothSigned).toBe(false)

    const second = await candidate(`/api/rooms/${state.roomId}/sign`, {
      method: 'POST',
      body: { imageDataUrl: sig },
    })
    expect(second.status).toBe(200)
    expect(second.json.bothSigned).toBe(true)

    const view = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    expect(view.json.room.status).toBe('signed')
    // 체결된 계약서에는 서명 전 점검을 더 보여주지 않는다.
    expect(view.json.preSignCheck).toBeNull()

    // 서명이 이루어진 접속 환경이 증거로 남아야 한다.
    for (const sig of view.json.signatures) {
      expect(sig.environment, `${sig.role} 서명에 접속 환경이 기록되지 않았습니다.`).toBeTruthy()
      expect(sig.environment).toContain('IP ')
    }
  })

  it('체결되면 회사 클릭 없이도 교부 기록이 생긴다', async () => {
    // 회사가 계약서 저장 버튼을 누르지 않은 상태다. 예전에는 교부물도 기록도
    // 없이 계약이 'signed'로 끝났다.
    const view = await company(`/api/rooms/${state.roomId}/contract-view`)
    expect(view.json.deliveryState, '교부 상태가 없습니다.').toBeTruthy()
    expect(view.json.deliveryState.delivered, '체결 후에도 교부 기록이 없습니다.').toBe(true)
    const inApp = view.json.deliveries.find((d) => d.channel === 'in_app')
    expect(inApp).toBeTruthy()
    expect(inApp.status).toBe('delivered')

    // 지원자가 계약서를 열면 확인 시각이 남는다 (전자문서법 제5조 수신 기록).
    await candidate(`/api/rooms/${state.roomId}/contract-view`)
    const after = await company(`/api/rooms/${state.roomId}/contract-view`)
    expect(after.json.deliveryState.viewed, '근로자 열람이 기록되지 않았습니다.').toBe(true)
    expect(after.json.deliveries.find((d) => d.channel === 'in_app').firstViewedAt).toBeTruthy()
  })

  it('계약 이력이 시간순으로 증명된다', async () => {
    const view = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    const events = view.json.auditTrail.events.map((e) => e.event)
    expect(events).toContain('면접방 생성')
    expect(events).toContain('지원자 참여')
    expect(events).toContain('계약 조건 수정')
    expect(events).toContain('회사 서명')
    expect(events).toContain('지원자 서명')

    // 감사추적증명서에는 서명 환경까지 담겨야 증거로서 의미가 있다.
    const signEvent = view.json.auditTrail.events.find((e) => e.event === '지원자 서명')
    expect(signEvent.detail).toContain('IP ')

    const times = view.json.auditTrail.events.map((e) => e.at)
    expect(times).toEqual([...times].sort())
  })

  it('외부 AI 요약이 실패해도 기존 대화와 회사 전용 조회 경계를 보존한다', async () => {
    // 요약할 만한 대화를 채운다 (최소 4건).
    const lines = [
      ['company', '근무는 주 5일, 09시부터 18시까지입니다. 가능하실까요?'],
      ['candidate', '네 가능합니다. 이전 직장에서도 같은 시간대로 3년 근무했습니다.'],
      ['company', '임금은 협의된 금액으로 하고, 지급일은 매월 25일입니다.'],
      ['candidate', '좋습니다. 4대보험 적용 여부만 확인 부탁드립니다.'],
    ]
    for (const [who, body] of lines) {
      const client = who === 'company' ? company : candidate
      const sent = await client(`/api/rooms/${state.roomId}/messages`, {
        method: 'POST',
        body: { body },
      })
      expect(sent.status).toBe(201)
    }

    // 지원자는 회사 보관용 기록을 볼 수 없다.
    const denied = await candidate(`/api/rooms/${state.roomId}/interview-summary`)
    expect(denied.status).toBe(403)

    const empty = await company(`/api/rooms/${state.roomId}/interview-summary`)
    expect(empty.status).toBe(200)
    expect(empty.json.summary).toBeNull()

    const written = await company(`/api/rooms/${state.roomId}/interview-summary`, { method: 'POST' })
    expect(written.status, '외부 AI 차단 상태').toBe(502)

    const saved = await company(`/api/rooms/${state.roomId}/interview-summary`)
    expect(saved.status).toBe(200)
    expect(saved.json.summary).toBeNull()
    const messages = await company(`/api/rooms/${state.roomId}/messages?after=0`)
    expect(messages.status).toBe(200)
    for (const [, line] of lines) expect(messages.json.messages.some(message => message.body === line)).toBe(true)
  })

  it('갱신 계약을 이전 계약과 이으면 계속근로기간이 합산된다', async () => {
    // 같은 근로자와 두 번째 계약을 맺는다 (계정은 그대로 쓴다).
    const room = await company('/api/rooms/create', {
      method: 'POST',
      body: { title: `E2E 갱신 ${RUN}` },
    })
    expect(room.status).toBe(201)
    state.renewalRoomId = room.json.id
    const join = await candidate('/api/rooms/join', {
      method: 'POST',
      body: { inviteCode: room.json.inviteCode },
    })
    expect(join.status).toBe(200)

    // A two-year renewal alone is within the existing period-check boundary.
    const renewalStart = dayOffset(END, 1)
    await company(`/api/rooms/${state.renewalRoomId}/contract`, {
      method: 'PATCH',
      body: { contractStartDate: renewalStart, contractEndDate: dayOffset(yearOffset(renewalStart, 2), -1) },
    })
    const alone = await company(`/api/rooms/${state.renewalRoomId}/contract-view`)
    expect(alone.json.period.exceedsFixedTermLimit).toBe(false)
    expect(alone.json.continuity.linked).toBe(false)
    // 회사에게는 이을 수 있는 이전 계약이 보여야 한다.
    expect(alone.json.linkableRooms.map((r) => r.id)).toContain(state.roomId)

    // 지원자는 연결을 설정할 수 없다.
    const denied = await candidate(`/api/rooms/${state.renewalRoomId}/link-previous`, {
      method: 'POST',
      body: { previousRoomId: state.roomId },
    })
    expect(denied.status).toBe(403)

    // 자기 자신과는 이을 수 없다.
    const self = await company(`/api/rooms/${state.renewalRoomId}/link-previous`, {
      method: 'POST',
      body: { previousRoomId: state.renewalRoomId },
    })
    expect(self.status).toBe(400)

    const linked = await company(`/api/rooms/${state.renewalRoomId}/link-previous`, {
      method: 'POST',
      body: { previousRoomId: state.roomId },
    })
    expect(linked.status, `연결 실패: ${linked.text}`).toBe(200)

    // 이어서 보면 2년을 넘고, 그때만 경고가 나온다.
    const joined = await candidate(`/api/rooms/${state.renewalRoomId}/contract-view`)
    expect(joined.json.continuity.linked).toBe(true)
    expect(joined.json.continuity.count).toBe(2)
    expect(joined.json.continuity.totalMonths).toBeGreaterThan(24)
    expect(joined.json.continuity.exceedsFixedTermLimit).toBe(true)
    const issue = joined.json.preSignCheck.legalIssues.find((i) => i.title.includes('계속근로'))
    expect(issue, '계속근로 2년 초과를 잡지 못했습니다.').toBeTruthy()
    expect(issue.severity).toBe('high')

    // 한 계약의 갱신은 하나뿐이다. 두 계약이 같은 계약을 이전으로 삼으면
    // 계속근로기간이 두 갈래로 갈라져 어느 쪽도 사실이 아니게 된다.
    const third = await company('/api/rooms/create', {
      method: 'POST',
      body: { title: `E2E 중복연결 ${RUN}` },
    })
    state.duplicateRoomId = third.json.id
    await candidate('/api/rooms/join', {
      method: 'POST',
      body: { inviteCode: third.json.inviteCode },
    })
    const duplicate = await company(`/api/rooms/${state.duplicateRoomId}/link-previous`, {
      method: 'POST',
      body: { previousRoomId: state.roomId },
    })
    expect(duplicate.status, `같은 계약을 두 번 이전으로 삼는 것을 막지 못했습니다.`).toBe(409)
    expect(duplicate.json.error).toContain('이미')

    // 연결을 풀면 경고도 사라진다.
    const unlinked = await company(`/api/rooms/${state.renewalRoomId}/link-previous`, {
      method: 'DELETE',
    })
    expect(unlinked.status).toBe(200)
    const after = await company(`/api/rooms/${state.renewalRoomId}/contract-view`)
    expect(after.json.continuity.linked).toBe(false)
    expect(after.json.preSignCheck.legalIssues.find((i) => i.title.includes('계속근로'))).toBeUndefined()
  })

  it('체결된 계약은 보존 의무 기간을 알려준다', async () => {
    const view = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    expect(view.json.retention.known).toBe(true)
    // The fixture's scheduled end remains in the future regardless of run date.
    expect(view.json.retention.until).toBe(yearOffset(END, 3))
    expect(view.json.retention.started).toBe(false)
    expect(view.json.retention.expired).toBe(false)
  })

  it('근로관계가 끝난 날을 기록하면 보존 기산일이 그 날로 바뀐다', async () => {
    // 근로기준법 제42조·시행령 제22조 제2항의 기산일은 계약 종료일이 아니라
    // 근로관계가 실제로 끝난 날이다.
    const denied = await candidate(`/api/rooms/${state.roomId}/employment-end`, {
      method: 'POST',
      body: { endedOn: ENDED_ON },
    })
    expect(denied.status).toBe(403)

    const tooEarly = await company(`/api/rooms/${state.roomId}/employment-end`, {
      method: 'POST', body: { endedOn: dayOffset(START, -1), reason: 'Invalid synthetic date' },
    })
    expect(tooEarly.status).toBe(400)
    const recorded = await company(`/api/rooms/${state.roomId}/employment-end`, {
      method: 'POST',
      body: { endedOn: ENDED_ON, reason: '중도 퇴사' },
    })
    expect(recorded.status, `종료 기록 실패: ${recorded.text}`).toBe(200)

    const view = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    expect(view.json.retention.basis).toBe(ENDED_ON)
    expect(view.json.retention.until).toBe(yearOffset(ENDED_ON, 3))
    expect(view.json.retention.started).toBe(true)
    expect(view.json.auditTrail.events.map((e) => e.event)).toContain('근로관계 종료 기록')
  })

  it('양측이 알림을 받았다', async () => {
    const forCompany = await company('/api/notifications')
    const forCandidate = await candidate('/api/notifications')
    expect(forCompany.json.notifications.length).toBeGreaterThan(0)
    expect(forCandidate.json.notifications.length).toBeGreaterThan(0)
  })
})
