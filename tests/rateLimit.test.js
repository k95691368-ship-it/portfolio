import { describe, it, expect } from 'vitest'
import { checkRateLimit, releaseRateLimit } from '../functions/_lib/rateLimit.js'

// D1을 흉내 내는 최소한의 가짜 DB.
// 이 모듈의 관심사는 SQL 실행이 아니라 "어떤 문장을 어떤 값으로 보내는가"이므로,
// 실행된 문장을 기록하고 SELECT COUNT만 답해 준다.
function fakeDb({ count = 0, lastRowId = 42 } = {}) {
  const calls = []
  return {
    calls,
    prepare(sql) {
      const statement = {
        sql,
        binds: [],
        bind(...args) {
          statement.binds = args
          return statement
        },
        async first() {
          calls.push({ sql, binds: statement.binds, kind: 'first' })
          return { count }
        },
        async run() {
          calls.push({ sql, binds: statement.binds, kind: 'run' })
          return { meta: { last_row_id: lastRowId } }
        },
      }
      return statement
    },
  }
}

const env = (db) => ({ DB: db })

describe('checkRateLimit', () => {
  it('한도 안이면 기록한 시도의 id를 돌려준다', async () => {
    const db = fakeDb({ count: 2, lastRowId: 77 })
    const ticket = await checkRateLimit(env(db), 'apply:1.1.1.1', 5, 3600)
    expect(ticket).toBe(77)
    // 만료 행 삭제 → 개수 조회 → 기록 순으로 진행한다
    expect(db.calls.filter((c) => c.sql.includes('INSERT INTO rate_limit_hits'))).toHaveLength(1)
  })

  it('한도에 도달하면 0을 돌려주고 기록하지 않는다', async () => {
    const db = fakeDb({ count: 5 })
    const ticket = await checkRateLimit(env(db), 'apply:1.1.1.1', 5, 3600)
    expect(ticket).toBe(0)
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO rate_limit_hits'))).toBe(false)
  })

  it('한도를 넘어선 뒤에도 막는다', async () => {
    const ticket = await checkRateLimit(env(fakeDb({ count: 9 })), 'b', 5, 60)
    expect(ticket).toBe(0)
  })

  it('돌려준 값은 조건문에서 그대로 쓸 수 있다', async () => {
    const allowed = await checkRateLimit(env(fakeDb({ count: 0, lastRowId: 1 })), 'b', 5, 60)
    const blocked = await checkRateLimit(env(fakeDb({ count: 5 })), 'b', 5, 60)
    expect(Boolean(allowed)).toBe(true)
    expect(Boolean(blocked)).toBe(false)
  })
})

describe('releaseRateLimit', () => {
  it('티켓이 있으면 그 id 하나만 지운다', async () => {
    const db = fakeDb()
    await releaseRateLimit(env(db), 'apply:1.1.1.1', 77)
    const del = db.calls.find((c) => c.sql.includes('DELETE'))
    expect(del.sql).toContain('WHERE id = ?')
    expect(del.sql).not.toContain('ORDER BY')
    expect(del.binds).toEqual([77])
  })

  it('티켓이 없으면 그 버킷의 가장 최근 기록을 지운다', async () => {
    const db = fakeDb()
    await releaseRateLimit(env(db), 'apply:1.1.1.1')
    const del = db.calls.find((c) => c.sql.includes('DELETE'))
    expect(del.sql).toContain('ORDER BY id DESC')
    expect(del.binds).toEqual(['apply:1.1.1.1'])
  })

  it('되돌리기가 실패해도 요청 처리를 막지 않는다', async () => {
    const broken = {
      prepare: () => ({
        bind: () => ({
          run: async () => {
            throw new Error('DB 접근 실패')
          },
        }),
      }),
    }
    await expect(releaseRateLimit(env(broken), 'b', 1)).resolves.toBeUndefined()
  })
})
