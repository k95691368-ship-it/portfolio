import { describe, it, expect } from 'vitest'
import { canMessage, partnerView } from '../functions/_lib/dm.js'

// 쪽지를 누가 누구에게 보낼 수 있는가.
//
// 이 규칙 하나가 이 기능의 전부다. 느슨하면 계정 목록이 그대로 스팸 명단이
// 된다 -- 이 서비스의 계정에는 실명과 회사명이 들어 있고, 지원자는 지원했다는
// 이유만으로 거기 올라간다.

// 질의문을 보고 무엇을 묻는지 알아내는 가짜 DB.
// shared: 같은 방에 있는가 / existing: 이미 오간 쪽지가 있는가
function fakeDb({ user, shared = false, existing = false }) {
  return {
    prepare(sql) {
      return {
        bind() {
          return this
        },
        async first() {
          if (sql.includes('FROM users')) return user
          if (sql.includes('room_participants')) return shared ? { 1: 1 } : null
          if (sql.includes('direct_messages')) return existing ? { 1: 1 } : null
          return null
        },
      }
    },
  }
}

const OTHER = { id: 'u2', display_name: '이지원', company_name: null, role: 'candidate', is_admin: 0, is_suspended: 0 }
const ME = { id: 'u1', display_name: '박서준', is_admin: 0, is_suspended: 0 }

describe('쪽지를 보낼 수 있는가', () => {
  it('관리자는 누구에게나 먼저 보낼 수 있다', async () => {
    // 운영자가 연락할 방법이 아예 없으면 계정 문제를 알릴 길이 없다.
    const env = { DB: fakeDb({ user: OTHER }) }
    const r = await canMessage(env, { ...ME, is_admin: 1 }, 'u2')
    expect(r.ok).toBe(true)
  })

  it('모르는 사이에는 먼저 보낼 수 없다', async () => {
    const env = { DB: fakeDb({ user: OTHER }) }
    const r = await canMessage(env, ME, 'u2')
    expect(r.ok).toBe(false)
  })

  it('같은 면접방에 있으면 보낼 수 있다', async () => {
    const env = { DB: fakeDb({ user: OTHER, shared: true }) }
    expect((await canMessage(env, ME, 'u2')).ok).toBe(true)
  })

  it('이미 쪽지가 오갔으면 답장할 수 있다', async () => {
    // 이게 없으면 관리자만 일방적으로 말하는 확성기가 된다.
    const env = { DB: fakeDb({ user: OTHER, existing: true }) }
    expect((await canMessage(env, ME, 'u2')).ok).toBe(true)
  })

  it('정지된 상대에게는 보낼 수 없다', async () => {
    const env = { DB: fakeDb({ user: { ...OTHER, is_suspended: 1 }, shared: true }) }
    expect((await canMessage(env, { ...ME, is_admin: 1 }, 'u2')).ok).toBe(false)
  })

  it('정지된 계정은 보내지 못한다', async () => {
    // 정지인데 쪽지만 계속 오갈 수 있으면 정지가 아니다.
    const env = { DB: fakeDb({ user: OTHER, shared: true }) }
    expect((await canMessage(env, { ...ME, is_suspended: 1 }, 'u2')).ok).toBe(false)
  })

  it('없는 사람과 정지된 사람을 같은 문장으로 돌려준다', async () => {
    // 문장이 갈리면 그것만으로 "이 계정이 있는가" 를 알아낼 수 있다.
    const gone = await canMessage({ DB: fakeDb({ user: null }) }, { ...ME, is_admin: 1 }, 'u2')
    const stopped = await canMessage(
      { DB: fakeDb({ user: { ...OTHER, is_suspended: 1 } }) },
      { ...ME, is_admin: 1 },
      'u2'
    )
    expect(gone.ok).toBe(false)
    expect(stopped.ok).toBe(false)
    expect(gone.reason).toBe(stopped.reason)
  })

  it('자기 자신에게는 보낼 수 없다', async () => {
    const env = { DB: fakeDb({ user: { ...OTHER, id: 'u1' } }) }
    expect((await canMessage(env, { ...ME, is_admin: 1 }, 'u1')).ok).toBe(false)
  })

  it('로그인하지 않았으면 보낼 수 없다', async () => {
    const env = { DB: fakeDb({ user: OTHER }) }
    expect((await canMessage(env, null, 'u2')).ok).toBe(false)
  })
})

describe('상대 이름 표시', () => {
  it('회사 계정은 회사명을 함께 적는다', () => {
    // 담당자 이름만으로는 어느 회사 사람인지 알 수 없다.
    const v = partnerView({ id: 'u3', display_name: '박서준', company_name: '(주)한빛테크', role: 'company', is_admin: 0 })
    expect(v.companyName).toBe('(주)한빛테크')
  })

  it('회사명이 없으면 빈 값 대신 null', () => {
    expect(partnerView({ ...OTHER }).companyName).toBeNull()
  })
})
