// 배포된 서비스를 실제로 두드려 보는 스모크 테스트.
//
// 순수 로직 테스트(다른 파일들)와 달리 여기서는 진짜 HTTP 요청을 보낸다.
// 목적은 세 가지다.
//   1) 모든 API 경로가 살아 있는가 — 이 프로젝트는 과거 라우트 충돌로
//      /api/* 전체가 404가 된 적이 있다. 배포 직후 바로 잡혀야 하는 사고다.
//   2) 권한 차단이 뚫리지 않았는가 — 비로그인/타역할 접근이 막히는지.
//   3) 공개 화면이 정상 동작하는가 — 공고 목록·상세·현황 조회.
//
// 데이터를 만들지 않으므로 운영 환경에 그대로 돌려도 안전하다.
//
// 실행: npm run smoke            (기본: 운영 도메인)
//       SMOKE_URL=<배포URL> npm run smoke
import { describe, expect, it } from 'vitest'

const BASE = process.env.SMOKE_URL || 'https://portfolio-epa.pages.dev'

async function call(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // JSON이 아니면 라우트가 없어 SPA HTML이 돌아온 것 — 아래에서 잡힌다.
  }
  return { status: res.status, json, text, contentType: res.headers.get('content-type') || '' }
}

// 로그인 없이 부르면 401/403이어야 하는 경로들.
// 여기서 확인하려는 건 "막혔는가"와 함께 "경로가 살아 있는가"다.
// 라우트가 사라지면 Pages가 SPA HTML(200)을 돌려주므로 즉시 드러난다.
const PROTECTED = [
  ['GET', '/api/notifications'],
  ['POST', '/api/notifications/read'],
  ['GET', '/api/documents/mine'],
  ['POST', '/api/documents/upload'],
  ['GET', '/api/postings'],
  ['POST', '/api/postings'],
  ['GET', '/api/applications'],
  ['GET', '/api/admin/users'],
  ['GET', '/api/admin/rooms'],
  ['GET', '/api/admin/audit-log'],
  // 근로계약서 저장소. 계약서 목록은 관리자만 볼 수 있어야 한다.
  ['GET', '/api/admin/contracts'],
  // 보관된 계약서 정본. 여기가 열려 있으면 남의 근로계약서가 통째로 나간다.
  ['POST', '/api/admin/contracts'],
  ['GET', '/api/admin/contracts/00000000-0000-0000-0000-000000000000/file'],
  // 쪽지함. 로그인 없이 열리면 남의 대화 상대 목록이 그대로 나간다.
  ['GET', '/api/dm'],
  ['GET', '/api/dm/00000000-0000-0000-0000-000000000000'],
  ['POST', '/api/dm/00000000-0000-0000-0000-000000000000'],
  // 데모 초기화는 데이터를 지우고 다시 만든다. 이 문이 열려 있으면 아무나
  // 운영 데이터를 건드릴 수 있다.
  ['GET', '/api/admin/demo/reset'],
  ['POST', '/api/admin/demo/reset'],
  ['POST', '/api/rooms/create'],
  ['POST', '/api/rooms/join'],
  ['GET', '/api/rooms/smoke-nonexistent/view'],
  ['GET', '/api/rooms/smoke-nonexistent/audit-certificate'],
  ['POST', '/api/rooms/smoke-nonexistent/audit-certificate'],
  ['GET', '/api/rooms/smoke-nonexistent/messages'],
  ['GET', '/api/rooms/smoke-nonexistent/contract'],
  ['GET', '/api/rooms/smoke-nonexistent/contract-view'],
  ['GET', '/api/rooms/smoke-nonexistent/change-requests'],
  ['POST', '/api/rooms/smoke-nonexistent/change-requests'],
  ['POST', '/api/rooms/smoke-nonexistent/change-requests/smoke-none'],
  ['POST', '/api/rooms/smoke-nonexistent/confirm-hire'],
  ['GET', '/api/rooms/smoke-nonexistent/signed-contract'],
  ['GET', '/api/rooms/smoke-nonexistent/signed-contract-file'],
  ['GET', '/api/rooms/smoke-nonexistent/invite-email'],
  ['GET', '/api/rooms/smoke-nonexistent/final-offer-email'],
  ['POST', '/api/rooms/smoke-nonexistent/analyze'],
  ['POST', '/api/rooms/smoke-nonexistent/sign'],
  ['POST', '/api/rooms/smoke-nonexistent/contract-draft'],
  ['POST', '/api/rooms/smoke-nonexistent/translate'],
  ['GET', '/api/rooms/smoke-nonexistent/interview-summary'],
  ['POST', '/api/rooms/smoke-nonexistent/interview-summary'],
  ['POST', '/api/rooms/smoke-nonexistent/link-previous'],
  ['DELETE', '/api/rooms/smoke-nonexistent/link-previous'],
  ['POST', '/api/rooms/smoke-nonexistent/close'],
  ['DELETE', '/api/rooms/smoke-nonexistent/close'],
  ['POST', '/api/rooms/smoke-nonexistent/employment-end'],
  ['DELETE', '/api/rooms/smoke-nonexistent/employment-end'],
  ['GET', '/api/my-applications'],
  ['GET', '/api/dashboard'],
  ['GET', '/api/postings/smoke-nonexistent/applications'],
  ['GET', '/api/applications/smoke-nonexistent'],
  ['POST', '/api/applications/smoke-nonexistent/screen'],
  ['POST', '/api/applications/smoke-nonexistent/pass'],
  ['POST', '/api/applications/smoke-nonexistent/reject'],
  ['GET', '/api/applications/smoke-nonexistent/doc/smoke'],
  ['GET', '/api/documents/smoke-nonexistent/download'],
]

describe(`배포 스모크 (${BASE})`, () => {
  it('첫 화면이 응답한다', async () => {
    const res = await fetch(BASE)
    expect(res.status).toBe(200)
  })

  describe('보호된 경로는 살아 있고, 비로그인은 막힌다', () => {
    for (const [method, path] of PROTECTED) {
      it(`${method} ${path}`, async () => {
        const res = await call(path, { method })
        // 라우트가 사라지면 SPA HTML이 200으로 돌아온다 — 그것부터 잡는다.
        expect(
          res.contentType.includes('application/json'),
          `${path} 가 JSON이 아닌 응답을 반환했습니다. 라우트가 사라졌을 수 있습니다.`
        ).toBe(true)
        expect([401, 403]).toContain(res.status)
        expect(res.json?.error).toBeTruthy()
      })
    }
  })

  describe('공개 경로', () => {
    it('채용 공고 목록을 반환한다', async () => {
      const res = await call('/api/jobs')
      expect(res.status).toBe(200)
      expect(Array.isArray(res.json?.postings)).toBe(true)
    })

    it('없는 공고는 404로 안내한다', async () => {
      const res = await call('/api/jobs/smoke-nonexistent')
      expect(res.status).toBe(404)
      expect(res.json?.error).toBeTruthy()
    })

    // 증명서는 계약 당사자가 아닌 사람에게 제시된다. 로그인 없이 확인할 수
    // 있어야 증명서로서 쓸모가 있다.
    it('증명서 확인은 로그인 없이 열려 있다', async () => {
      const res = await call('/api/verify-certificate?serial=AC-ABCD-EFGH-JKMN')
      expect(res.status).toBe(404) // 형식은 맞지만 발급된 적 없는 번호
      expect(res.json?.error).toBeTruthy()
    })

    it('형식이 틀린 발급번호는 400으로 안내한다', async () => {
      const res = await call('/api/verify-certificate?serial=abc')
      expect(res.status).toBe(400)
      expect(res.json?.error).toContain('AC-')
    })

    // 체험 안내는 공개가 목적이다. 다만 내려주는 계정이 데모 계정으로만
    // 한정되는지는 계속 확인해야 한다 — 여기가 새면 사람의 계정이 나간다.
    it('체험 안내는 데모 계정만 내려준다', async () => {
      const res = await call('/api/demo')
      expect(res.status).toBe(200)
      if (res.json?.seeded) {
        expect(Array.isArray(res.json.accounts)).toBe(true)
        for (const a of res.json.accounts) {
          expect(a.email.endsWith('@demo.invalid')).toBe(true)
        }
        // 비밀번호는 데모 계정의 것만 공개된다.
        expect(typeof res.json.password).toBe('string')
      }
    })

    // 체험 시작은 비밀번호 없이 세션을 만들어 준다. 이 앱에서 가장 위험한
    // 문이므로, 열 수 있는 대상이 체험 계정으로만 한정되는지 계속 확인한다.
    it('체험 시작은 체험 계정만 연다', async () => {
      const res = await call('/api/demo/login', {
        method: 'POST',
        body: JSON.stringify({ role: 'admin' }),
      })
      expect([400, 404, 429]).toContain(res.status)
    })

    it('화면이 보낸 이메일로는 체험 로그인을 시켜 주지 않는다', async () => {
      const res = await call('/api/demo/login', {
        method: 'POST',
        body: JSON.stringify({ role: 'company', email: 'someone@real.example.com' }),
      })
      // 열리더라도 그것은 role 로 고른 체험 계정이어야 한다.
      if (res.status === 200) {
        expect(res.json?.email).toMatch(/@demo\.invalid$/)
      }
    })

    it('마감·미존재 공고에는 지원할 수 없다', async () => {
      const res = await call('/api/jobs/smoke-nonexistent/apply', { method: 'POST' })
      expect([400, 404, 429]).toContain(res.status)
      expect(res.json?.error).toBeTruthy()
    })

    it('접수번호 없이 현황을 조회하면 안내한다', async () => {
      const res = await call('/api/application-status')
      expect([400, 429]).toContain(res.status)
      expect(res.json?.error).toBeTruthy()
    })

    it('없는 접수번호는 404로 안내한다', async () => {
      const res = await call('/api/application-status?code=SMOKENONE1')
      expect([404, 429]).toContain(res.status)
    })
  })

  describe('로그인', () => {
    it('빈 요청을 거부한다', async () => {
      const res = await call('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('틀린 비밀번호를 거부하고 계정 존재 여부를 흘리지 않는다', async () => {
      const res = await call('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'smoke-nobody@example.com', password: 'wrong-password' }),
      })
      expect([401, 429]).toContain(res.status)
      if (res.status === 401) {
        // 있는 계정과 없는 계정의 응답이 같아야 계정 존재 여부가 새지 않는다.
        expect(res.json.error).toBe('이메일 또는 비밀번호가 올바르지 않습니다.')
      }
    })
  })

  it('로그인하지 않으면 사용자 정보가 비어 있다', async () => {
    // /api/me는 로그인 여부를 확인하는 용도라 비로그인도 정상 응답한다.
    const res = await call('/api/me')
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ user: null })
  })
})
