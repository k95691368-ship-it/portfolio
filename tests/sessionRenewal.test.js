// 쓰고 있는 동안에는 로그인이 끝나지 않아야 한다. 다만 "언제 미룰 것인가"를
// SQL 에만 걸어 두면, 미룰 필요가 없는 요청에서도 쓰기가 한 번씩 나간다.
// 로그인한 사람의 모든 요청마다 UPDATE 를 쏘는 셈이었다.
import { describe, expect, it } from 'vitest'
import { needsRenewal } from '../functions/_lib/auth.js'

const DAY = 24 * 60 * 60 * 1000
const iso = (ms) => new Date(ms).toISOString()
// 서버가 남기는 두 가지 표기를 모두 받아야 한다.
const sqlite = (ms) => iso(ms).replace('T', ' ').replace(/\..*$/, '')

const session = (startedDaysAgo, expiresInDays, fmt = iso) => ({
  session_started_at: fmt(Date.now() - startedDaysAgo * DAY),
  session_expires_at: fmt(Date.now() + expiresInDays * DAY),
})

describe('만료를 미뤄야 하는가', () => {
  it('막 로그인한 세션은 미루지 않는다 — 쓸 일이 없다', () => {
    expect(needsRenewal(session(0, 30))).toBe(false)
  })

  it('절반 아래로 내려가면 미룬다', () => {
    expect(needsRenewal(session(20, 10))).toBe(true)
    expect(needsRenewal(session(29, 1))).toBe(true)
  })

  it('경계 근처에서 갈린다', () => {
    expect(needsRenewal(session(15, 16))).toBe(false)
    expect(needsRenewal(session(16, 14))).toBe(true)
  })

  // 브라우저를 닫으면 끝나기로 한 로그인(12시간)은 미루지 않는다.
  // 미루면 "로그인 유지 안 함"을 골랐는데 유지되는 셈이 된다.
  it('유지를 고르지 않은 세션은 미루지 않는다', () => {
    expect(
      needsRenewal({
        session_started_at: iso(Date.now() - 11 * 60 * 60 * 1000),
        session_expires_at: iso(Date.now() + 60 * 60 * 1000),
      })
    ).toBe(false)
  })

  it('SQLite 표기("2026-08-12 09:00:00")도 읽는다', () => {
    expect(needsRenewal(session(20, 10, sqlite))).toBe(true)
    expect(needsRenewal(session(0, 30, sqlite))).toBe(false)
  })

  it('값이 없거나 읽을 수 없으면 미루지 않는다 — 모르면 건드리지 않는다', () => {
    expect(needsRenewal(null)).toBe(false)
    expect(needsRenewal({})).toBe(false)
    expect(needsRenewal({ session_started_at: '어제', session_expires_at: '내일' })).toBe(false)
  })
})
