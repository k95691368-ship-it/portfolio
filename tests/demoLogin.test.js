import { describe, it, expect } from 'vitest'
import { DEMO_ACCOUNTS, DEMO_DOMAIN } from '../functions/_lib/demoSeed.js'
import { onRequestPost } from '../functions/api/demo/login.js'

// 이 경로는 비밀번호 없이 세션을 만들어 준다. 이 앱에서 가장 위험한 문이다.
// 열 수 있는 대상이 체험 계정으로만 한정되는지 여기서 못박는다.

const req = (body) =>
  new Request('https://x/api/demo/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
    body: JSON.stringify(body),
  })

// 시도 제한과 계정 조회만 흉내 내는 가짜 DB.
function fakeDb(users) {
  return {
    prepare(sql) {
      const st = {
        _b: [],
        bind(...a) { st._b = a; return st },
        async run() { return { meta: { last_row_id: 1, changes: 1 } } },
        async first() {
          if (sql.includes('COUNT(*) AS count')) return { count: 0 }
          if (sql.includes('FROM users WHERE email = ?')) {
            // _any 는 "무엇을 물어도 이 행을 준다"는 뜻이다. DB 가 기대와
            // 다른 행을 돌려주는 상황을 흉내 내는 데 쓴다.
            if (users[0]?._any) return users[0]
            return users.find((u) => u.email === st._b[0]) ?? null
          }
          return null
        },
        async all() { return { results: [] } },
      }
      return st
    },
  }
}

const demoUser = (email, extra = {}) => ({
  id: `id-${email}`, email, role: 'company', display_name: '박서준',
  is_admin: 0, is_recruiter: 1, is_developer: 0, is_suspended: 0, ...extra,
})

const call = async (body, users) =>
  onRequestPost({ request: req(body), env: { DB: fakeDb(users) } })

describe('체험 바로 시작', () => {
  it('체험 계정으로는 열린다', async () => {
    const acct = DEMO_ACCOUNTS.find((a) => a.role === 'company')
    const res = await call({ role: 'company' }, [demoUser(acct.email)])
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.email).toBe(acct.email)
    expect(json.demo).toBe(true)
    // 창을 닫으면 끝나야 한다. 공용 컴퓨터에서 둘러보고 떠난 세션이 남으면 안 된다.
    const cookie = res.headers.get('Set-Cookie') || ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).not.toContain('Max-Age')
  })

  it('화면이 보낸 이메일로는 로그인시키지 않는다', async () => {
    // 여기가 뚫리면 비밀번호 없이 남의 계정이 열린다.
    const victim = demoUser('k95691368@gmail.com')
    const res = await call({ role: 'company', email: victim.email }, [victim])
    // role 로 고른 체험 계정이 없으므로 404 여야 한다. 절대 200 이면 안 된다.
    expect(res.status).not.toBe(200)
  })

  it('모르는 역할은 거절한다', async () => {
    const res = await call({ role: 'admin' }, [])
    expect(res.status).toBe(400)
  })

  it('예시안이 심어져 있지 않으면 열지 않는다', async () => {
    // 지운 상태에서 이 문만 살아 있으면, 나중에 누가 그 주소로 가입했을 때 열린다.
    const res = await call({ role: 'company' }, [])
    expect(res.status).toBe(404)
  })

  it('체험용 주소가 아닌 계정이 걸리면 열지 않는다', async () => {
    const acct = DEMO_ACCOUNTS.find((a) => a.role === 'company')
    // DB 가 같은 자리에 다른 주소를 돌려주는 상황을 흉내 낸다.
    const res = await call({ role: 'company' }, [
      { ...demoUser(acct.email), email: 'someone@real.example.com', _any: true },
    ])
    expect(res.status).toBe(400)
  })

  it('정지된 체험 계정은 열지 않는다', async () => {
    const acct = DEMO_ACCOUNTS.find((a) => a.role === 'company')
    const res = await call({ role: 'company' }, [demoUser(acct.email, { is_suspended: 1 })])
    expect(res.status).toBe(403)
  })

  it('열 수 있는 계정은 전부 체험용 주소다', () => {
    for (const a of DEMO_ACCOUNTS) {
      expect(a.email.endsWith(`@${DEMO_DOMAIN}`)).toBe(true)
    }
  })
})
