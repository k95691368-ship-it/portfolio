import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Live database access is forbidden') } }))
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { onRequestPost as linkPrevious } from '../server/api/rooms/[roomId]/link-previous.js'

// 이전 계약 사슬 확인이 실제 PostgreSQL 에서 한 번의 질의로 끝나고,
// 순환·길이 제한 판정은 한 칸씩 되묻던 때와 같은지 본다.
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
const company = { id: 'company', role: 'company', is_recruiter: 1 }
const link = (roomId, previousRoomId) => linkPrevious({
  env: { DB: db }, data: { user: company }, params: { roomId },
  request: new Request(`https://test.invalid/api/rooms/${roomId}/link-previous`, { method: 'POST', body: JSON.stringify({ previousRoomId }) }),
})
const chainQueries = () => statements.filter((query) => /previous_room_id/.test(query) && /^\s*(WITH|SELECT)/i.test(query) && !/c\.previous_room_id =/.test(query))

async function room(id, status = 'signed') {
  await pg.query(`INSERT INTO interview_rooms (id, company_user_id, title, invite_code, status) VALUES ($1, 'company', $1, $2, $3)`, [id, `code-${id}`, status])
  await pg.query(`INSERT INTO room_participants (room_id, user_id, role_in_room) VALUES ($1, 'company', 'company'), ($1, 'worker', 'candidate')`, [id])
}
const chain = (roomId, previous) => pg.query(
  'INSERT INTO contract_terms (room_id, previous_room_id) VALUES ($1, $2) ON CONFLICT (room_id) DO UPDATE SET previous_room_id = excluded.previous_room_id',
  [roomId, previous])

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT);')
  await pg.exec(readFileSync('supabase/migrations/202609030001_cloudflare_to_supabase.sql', 'utf8'))
  db = new PostgresD1(adapter(pg))
  await pg.query(`INSERT INTO users (id, email, password_hash, password_salt, role, display_name) VALUES
    ('company', 'company@test.invalid', 'x', 'x', 'company', '회사'), ('worker', 'worker@test.invalid', 'x', 'x', 'candidate', '근로자')`)
  // c1 <- c2 <- ... <- c10 : 체결된 계약 열 건이 이어진 사슬(이으면 열한 건)
  for (let i = 1; i <= 10; i++) {
    await room(`c${i}`)
    if (i > 1) await chain(`c${i}`, `c${i - 1}`)
  }
  await room('short-1'); await room('short-2'); await chain('short-2', 'short-1')
  await room('new-a', 'active'); await room('new-b', 'active'); await room('loop', 'active')
}, 30000)
beforeEach(() => { statements.length = 0 })

it('짧은 사슬은 연결하고, 거슬러 오르는 질의는 한 번이다', async () => {
  const response = await link('new-a', 'short-2')
  expect(response.status).toBe(200)
  expect(chainQueries()).toHaveLength(1)
  expect((await pg.query("SELECT previous_room_id FROM contract_terms WHERE room_id = 'new-a'")).rows[0].previous_room_id).toBe('short-2')
})

it('상한을 넘는 사슬은 예전과 같이 409로 막는다', async () => {
  const response = await link('new-b', 'c10')
  expect(response.status).toBe(409)
  expect((await response.json()).error).toContain('10건까지')
  expect(chainQueries()).toHaveLength(1)
})

it('거슬러 오르다 이 방이 나오면 순환으로 막는다', async () => {
  // loop 를 이미 x 의 이전 계약으로 둔 상태에서 loop 의 이전 계약으로 x 를 고르면 고리가 된다.
  await room('x')
  await chain('x', 'loop')
  const response = await link('loop', 'x')
  expect(response.status).toBe(400)
  expect((await response.json()).error).toContain('순환')
  expect(chainQueries()).toHaveLength(1)
})

it('이미 이어진 계약은 막고, 상한 바로 아래 사슬(아홉 건)은 연결한다', async () => {
  const response = await link('new-b', 'c9')
  expect(response.status).toBe(409) // c9 는 이미 c10 의 이전 계약이다
  expect((await response.json()).error).toContain('이미 다른 계약')
  await room('new-c', 'active'); await room('nine-1')
  for (let i = 2; i <= 9; i++) { await room(`nine-${i}`); await chain(`nine-${i}`, `nine-${i - 1}`) }
  statements.length = 0
  expect((await link('new-c', 'nine-9')).status).toBe(200)
  expect(chainQueries()).toHaveLength(1)
})
