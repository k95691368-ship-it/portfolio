import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Live database access is forbidden') } }))
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { checkRateLimit } from '../server/_lib/rateLimit.js'

// 사용량 제한은 창 밖의 기록을 매번 지우지 않고 개수를 셀 때 시간 범위로 거른다.
// 화상 면접 신호처럼 1초마다 오는 요청에서 호출마다 질의가 하나 줄어든다.
let pg, db
const statements = []
const adapter = (client) => ({
  async unsafe(query, values = []) {
    statements.push(query)
    const result = await client.query(query, values)
    return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length })
  },
  begin(operation) { return client.transaction((transaction) => operation(adapter(transaction))) },
})
const hits = async (bucket) => Number((await pg.query('SELECT COUNT(*) AS n FROM rate_limit_hits WHERE bucket = $1', [bucket])).rows[0].n)

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT);')
  await pg.exec(readFileSync('supabase/migrations/202609030001_cloudflare_to_supabase.sql', 'utf8'))
  db = new PostgresD1(adapter(pg))
}, 30000)
afterAll(async () => { await pg?.close() })
beforeEach(() => { statements.length = 0 })
afterEach(() => { vi.restoreAllMocks() })

it('창 밖의 오래된 기록은 세지 않고, 창 안에서는 한도에서 정확히 막는다', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5) // 정리를 건너뛰는 호출
  await pg.query("INSERT INTO rate_limit_hits (bucket, created_at) SELECT 'window', to_char(timezone('utc', now()) - interval '2 hours', 'YYYY-MM-DD HH24:MI:SS') FROM generate_series(1, 5)")
  const granted = []
  for (let i = 0; i < 3; i++) granted.push(await checkRateLimit({ DB: db }, 'window', 3, 3600))
  expect(granted.every(Boolean)).toBe(true)
  expect(await checkRateLimit({ DB: db }, 'window', 3, 3600)).toBe(0)
  // 오래된 5줄 + 허용된 3줄. 막힌 시도는 기록되지 않는다.
  expect(await hits('window')).toBe(8)
})

it('정리를 건너뛰는 호출은 잠금과 기록 두 질의로 끝난다', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  expect(await checkRateLimit({ DB: db }, 'calls', 5, 60)).toBeTruthy()
  // 예전에는 잠금 → 이 버킷 정리 → 기록, 세 질의였다.
  expect(statements.filter((query) => !/^\s*(BEGIN|COMMIT)/i.test(query))).toHaveLength(2)
})

it('열 번에 한 번꼴의 정리는 창 밖의 기록만 지운다', async () => {
  await pg.query("INSERT INTO rate_limit_hits (bucket, created_at) VALUES ('purge', to_char(timezone('utc', now()) - interval '2 hours', 'YYYY-MM-DD HH24:MI:SS'))")
  vi.spyOn(Math, 'random').mockReturnValue(0.05) // 버킷 정리는 하고, 전역 청소(2%)는 건너뛴다
  expect(await checkRateLimit({ DB: db }, 'purge', 5, 60)).toBeTruthy()
  expect(await hits('purge')).toBe(1)
})
