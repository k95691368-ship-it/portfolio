import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Live database access is forbidden') } }))
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { onRequestGet as getRoomView } from '../server/api/rooms/[roomId]/view.js'
import { onRequestGet as getContractView } from '../server/api/rooms/[roomId]/contract-view.js'

// 방 화면은 방 정보와 참여 여부를 함께 읽는다. (대화 폴링은 권한이 확인되기 전에는 메시지를
// 읽지 않는다는 규칙이 있어 그대로 둔다 — tests/interviewsMessages.test.js)
// 질의마다 같은 지연을 주고, 그 지연이 몇 번 차례로 쌓이는지(DB 대기 단계)를 센다.
const DELAY = 30
let pg, db, inFlight = 0, peak = 0, stages = 0
const adapter = (client) => ({
  async unsafe(query, values = []) {
    if (inFlight++ === 0) stages++
    peak = Math.max(peak, inFlight)
    try {
      await new Promise((resolve) => setTimeout(resolve, DELAY))
      const result = await client.query(query, values)
      return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length })
    } finally { inFlight-- }
  },
  begin(operation) { return client.transaction((transaction) => operation(adapter(transaction))) },
})
const owner = { id: 'owner', role: 'company', display_name: '회사' }
const outsider = { id: 'outsider', role: 'candidate', display_name: '외부인' }
const request = (user, suffix, handler) => handler({
  env: { DB: db }, data: { user }, params: { roomId: 'room' }, waitUntil() {},
  request: new Request(`https://test.invalid/api/rooms/room/${suffix}`),
})

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT);')
  await pg.exec(readFileSync('supabase/migrations/202609030001_cloudflare_to_supabase.sql', 'utf8'))
  await pg.exec(`INSERT INTO users (id, email, password_hash, password_salt, role, display_name) VALUES
      ('owner', 'owner@test.invalid', 'x', 'x', 'company', '회사'), ('outsider', 'out@test.invalid', 'x', 'x', 'candidate', '외부인');
    INSERT INTO interview_rooms (id, company_user_id, title, status, invite_code) VALUES ('room', 'owner', '면접방', 'open', 'CODE2345AB');
    INSERT INTO users (id, email, password_hash, password_salt, role, display_name) VALUES ('worker', 'worker@test.invalid', 'x', 'x', 'candidate', '근로자');
    INSERT INTO room_participants (room_id, user_id, role_in_room) VALUES ('room', 'owner', 'company'), ('room', 'worker', 'candidate');
    INSERT INTO contract_terms (room_id) VALUES ('room');
    INSERT INTO chat_messages (room_id, sender_user_id, body) VALUES ('room', 'owner', '안녕하세요');`)
  db = new PostgresD1(adapter(pg))
}, 30000)
beforeEach(() => { peak = 0; stages = 0 })

it('방 화면은 방 정보와 참여 여부를 함께 읽는다', async () => {
  const response = await request(owner, 'view', getRoomView)
  expect(response.status).toBe(200)
  // 방·참여 확인(1) → 참여자·조건·대화 등(2) → 서류·요약(3)
  expect(stages).toBeLessThanOrEqual(3)
  expect((await request(outsider, 'view', getRoomView)).status).toBe(403)
})

it('계약서 화면은 원 공고·연결 가능한 계약 조회를 함께 보낸다', async () => {
  const response = await request(owner, 'contract-view', getContractView)
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.linkableRooms).toEqual([])
  // 참여 확인(1) → 계약 자료(2) → 원 공고·연결 가능한 계약(3). 하나씩 기다리면 4단계였다.
  expect(stages).toBe(3)
})
