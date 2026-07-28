// 실제 배포 환경에서 계약 체결까지의 전 과정을 자동으로 돌려보는 테스트.
//
// 스모크 테스트가 "경로가 살아 있는가"를 본다면, 여기서는 "흐름이 실제로
// 이어지는가"를 본다. 지금까지 이 과정을 손으로 돌려 확인해 왔는데,
// 합의로 바뀐 값을 불일치로 오인하던 결함처럼 끝까지 돌려봐야만 드러나는
// 문제가 실제로 있었다.
//
// 데이터를 만들기 때문에 끝나면 스스로 지운다(관리자 계정으로 방·계정 삭제).
// 관리자 자격이 없으면 건너뛴다.
//
// 실행:
//   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run e2e
//   (대상 주소는 SMOKE_URL 로 바꿀 수 있다)
import { describe, expect, it, beforeAll, afterAll } from 'vitest'

const BASE = process.env.SMOKE_URL || 'https://portfolio-epa.pages.dev'
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD
const RUN = `e2e${Date.now().toString(36)}`
const PASSWORD = 'e2e-test-password-2026'

// 쿠키를 직접 들고 다닌다 (fetch에는 쿠키 저장소가 없다).
function makeClient() {
  let cookie = ''
  return async function call(path, { method = 'GET', body, raw } = {}) {
    const headers = {}
    if (cookie) headers.Cookie = cookie
    if (body && !raw) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: raw ? body : body ? JSON.stringify(body) : undefined,
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) {
      const session = setCookie.split(';')[0]
      if (session.startsWith('session=')) cookie = session
    }
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 라우트가 없으면 HTML이 온다 */
    }
    return { status: res.status, json, text }
  }
}

const company = makeClient()
const candidate = makeClient()
const admin = makeClient()

const state = { roomId: null, companyId: null, candidateId: null, requestId: null }
const hasAdmin = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD)

describe.skipIf(!hasAdmin)(`계약 체결 전 과정 (${BASE})`, () => {
  beforeAll(async () => {
    const res = await admin('/api/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    })
    expect(res.status, '관리자 로그인에 실패했습니다. 자격 증명을 확인하세요.').toBe(200)

    // 계정 생성은 여기서 끝낸다. 가입 제한에 걸리면 이후 검사가 줄줄이
    // 실패해 원인이 묻히므로, 한 줄로 분명히 알린다.
    const c = await company('/api/signup', {
      method: 'POST',
      body: {
        email: `${RUN}-co@example.com`,
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
    expect(c.status, `회사 가입 실패: ${c.text}`).toBe(201)
    state.companyId = c.json.id

    const k = await candidate('/api/signup', {
      method: 'POST',
      body: {
        email: `${RUN}-ca@example.com`,
        password: PASSWORD,
        role: 'candidate',
        displayName: 'E2E지원자',
      },
    })
    expect(k.status, `지원자 가입 실패: ${k.text}`).toBe(201)
    state.candidateId = k.json.id
  })

  afterAll(async () => {
    // 만든 것은 반드시 지운다. 실패해도 다음 정리를 계속 시도한다.
    if (state.roomId) {
      await admin(`/api/admin/rooms/${state.roomId}`, { method: 'DELETE' }).catch(() => {})
    }
    for (const id of [state.candidateId, state.companyId]) {
      if (id) await admin(`/api/admin/users/${id}`, { method: 'DELETE' }).catch(() => {})
    }
  })

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
        contractStartDate: '2026-09-01',
        workHoursStart: '09:00',
        workHoursEnd: '18:00',
        workDays: '주 5일 (월~금)',
        wageBaseAmount: 1700000, // 최저임금 미달 — 점검이 잡아야 한다
        wagePayDate: '매월 25일',
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

  it('본문이 조건과 어긋나면 서명이 막힌다', async () => {
    // 계약서 본문은 채용자 권한이 있어야 작성할 수 있다.
    const granted = await admin(`/api/admin/users/${state.companyId}`, {
      method: 'PATCH',
      body: { isRecruiter: true },
    })
    expect(granted.status, `채용자 권한 부여 실패: ${granted.text}`).toBe(200)

    const before = await company(`/api/rooms/${state.roomId}/contract-view`)
    const draft = await company(`/api/rooms/${state.roomId}/contract-draft`, {
      method: 'POST',
      body: before.json.contract.terms,
    })
    expect(draft.status, `AI 계약서 작성 실패: ${draft.text}`).toBe(200)
    expect(draft.json.articles.length).toBeGreaterThan(0)

    // 방금 만든 본문은 현재 조건과 같아야 한다.
    const fresh = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    const doc = fresh.json.preSignCheck.documentCheck
    expect(doc.hasDocument).toBe(true)
    expect(doc.issues.find((i) => i.field === 'wageBaseAmount')).toBeUndefined()

    // 본문은 그대로 두고 기본급만 바꾼다 — 예전에는 이 상태로 서명이 됐다.
    const bumped = Number(state.suggested) + 500000
    await company(`/api/rooms/${state.roomId}/contract`, {
      method: 'PATCH',
      body: { wageBaseAmount: bumped },
    })

    const stale = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    const wage = stale.json.preSignCheck.documentCheck.issues.find(
      (i) => i.field === 'wageBaseAmount'
    )
    expect(wage, '본문과 조건의 임금 불일치를 잡지 못했습니다.').toBeTruthy()
    expect(wage.conflict).toBe(true)
    expect(stale.json.preSignCheck.hasBlocking).toBe(true)

    const blocked = await company(`/api/rooms/${state.roomId}/sign`, {
      method: 'POST',
      body: { imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
    })
    expect(blocked.status, `본문 불일치 상태에서 서명이 막히지 않았습니다: ${blocked.text}`).toBe(409)
    expect(blocked.json.error).toContain('본문')

    // 본문에 적힌 금액으로 되돌리면 다시 서명할 수 있다.
    await company(`/api/rooms/${state.roomId}/contract`, {
      method: 'PATCH',
      body: { wageBaseAmount: Number(state.suggested) },
    })
    const fixed = await candidate(`/api/rooms/${state.roomId}/contract-view`)
    expect(
      fixed.json.preSignCheck.documentCheck.issues.find((i) => i.field === 'wageBaseAmount')
    ).toBeUndefined()
    // AI가 계약서 본문을 쓰는 데 시간이 걸려 기본 제한(5초)으로는 부족하다.
  }, 120000)

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

  it('양측이 알림을 받았다', async () => {
    const forCompany = await company('/api/notifications')
    const forCandidate = await candidate('/api/notifications')
    expect(forCompany.json.notifications.length).toBeGreaterThan(0)
    expect(forCandidate.json.notifications.length).toBeGreaterThan(0)
  })
})
