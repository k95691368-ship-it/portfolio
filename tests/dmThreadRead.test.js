import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Live database access is forbidden') } }))
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestGet } from '../server/api/dm/[partnerId].js'

// 쪽지 창(7초마다)은 대화 조회와 읽음 표시를 함께 보낸다. 응답은 예전처럼
// "조회한 뒤 읽음 표시" 순서와 같아야 한다 -- 이번에 읽은 줄은 응답에서 안 읽음이다.
const open = (db, user = 'me', partnerId = 'other') => onRequestGet({ env: { DB: db }, data: { user: { id: user } }, params: { partnerId } })

async function scenario(db, insert, readAtOf) {
  await insert('other', 'me', '처음 받은 쪽지')
  await insert('me', 'other', '내 답장')
  const first = await (await open(db)).json()
  expect(first.messages.map((m) => [m.body, m.fromMe, m.readAt])).toEqual([
    ['처음 받은 쪽지', false, null],
    ['내 답장', true, null],
  ])
  // 서버에는 읽음이 남는다.
  expect(await readAtOf('처음 받은 쪽지')).toBeTruthy()
  // 다시 열면 이미 읽은 줄의 시각이 그대로 나온다.
  const second = await (await open(db)).json()
  expect(second.messages[0].readAt).toBeTruthy()
  // 상대가 열면 내 답장이 읽음이 된다. 상대 응답에서는 방금 읽은 줄이 안 읽음이다.
  const partner = await (await open(db, 'other', 'me')).json()
  expect(partner.messages.find((m) => m.body === '내 답장').readAt).toBeNull()
  const mine = await (await open(db)).json()
  expect(mine.messages.find((m) => m.body === '내 답장').readAt).toBeTruthy()
}

it('SQLite(D1): 읽음 표시와 조회를 함께 보내도 응답은 예전과 같다', async () => {
  const db = sqliteApp()
  try {
    seedUser(db, 'me'); seedUser(db, 'other')
    await scenario(db,
      async (from, to, body) => { db.sql.prepare('INSERT INTO direct_messages (sender_id,recipient_id,body) VALUES (?,?,?)').run(from, to, body) },
      async (body) => db.sql.prepare('SELECT read_at FROM direct_messages WHERE body = ?').get(body).read_at)
  } finally { db.close() }
})

let pg
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT);')
  await pg.exec(readFileSync('supabase/migrations/202609030001_cloudflare_to_supabase.sql', 'utf8'))
  await pg.exec(`INSERT INTO users (id, email, password_hash, password_salt, role, display_name) VALUES
    ('me', 'me@test.invalid', 'x', 'x', 'candidate', '나'), ('other', 'other@test.invalid', 'x', 'x', 'company', '상대')`)
}, 30000)
afterAll(async () => { await pg?.close() })

it('PostgreSQL: 조회와 읽음 표시가 한 단계로 끝나고 응답은 예전과 같다', async () => {
  let inFlight = 0, stages = 0
  const adapter = (client) => ({
    async unsafe(query, values = []) {
      if (inFlight++ === 0) stages++
      try {
        await new Promise((resolve) => setTimeout(resolve, 10))
        const result = await client.query(query, values)
        return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length })
      } finally { inFlight-- }
    },
    begin(operation) { return client.transaction((transaction) => operation(adapter(transaction))) },
  })
  const db = new PostgresD1(adapter(pg))
  await scenario(db,
    (from, to, body) => pg.query('INSERT INTO direct_messages (sender_id, recipient_id, body) VALUES ($1, $2, $3)', [from, to, body]),
    async (body) => (await pg.query('SELECT read_at FROM direct_messages WHERE body = $1', [body])).rows[0].read_at)
  stages = 0
  expect((await open(db)).status).toBe(200)
  // 상대 확인(1) → 같은 방·기존 대화 확인(2) → 대화 조회·읽음 표시(3). 차례로 기다리면 4단계였다.
  expect(stages).toBe(3)
})
