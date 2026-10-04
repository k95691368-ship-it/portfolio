import { afterEach, beforeEach, expect, it } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestGet } from '../server/api/rooms/[roomId]/interviews/[sessionId]/index.js'

// 면접 화면은 5초마다 세션 상태를 다시 읽는다. 권한 확인 뒤의 세션 행·참가자·녹화
// 조회는 함께 보낸다. 질의마다 같은 지연을 주고 차례로 쌓이는 단계를 센다.
let db, users, inFlight, stages
beforeEach(() => {
  db = sqliteApp()
  users = { host: seedUser(db, 'host', 'company'), candidate: seedUser(db, 'candidate'), outsider: seedUser(db, 'outsider') }
  db.sql.exec(`INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code) VALUES ('room','host','Test','active','ABCD2345EFGH');
    INSERT INTO room_participants (room_id,user_id,role_in_room) VALUES ('room','host','company'), ('room','candidate','candidate');
    INSERT INTO interview_sessions (id,room_id,provider_meeting_id,title,status) VALUES ('session','room','meeting','Test','live');
    INSERT INTO interview_session_members (session_id,user_id,role,custom_participant_id) VALUES ('session','host','host','custom-host');`)
  inFlight = 0
  stages = 0
  const prepare = db.prepare.bind(db)
  db.prepare = (source) => {
    const statement = prepare(source)
    const bind = statement.bind.bind(statement)
    statement.bind = (...values) => {
      const bound = bind(...values)
      for (const method of ['first', 'all', 'run']) {
        const original = bound[method].bind(bound)
        bound[method] = async () => {
          if (inFlight++ === 0) stages++
          try {
            await new Promise((resolve) => setTimeout(resolve, 10))
            return await original()
          } finally { inFlight-- }
        }
      }
      return bound
    }
    return statement
  }
})
afterEach(() => { db.close() })
const get = (user) => onRequestGet({ env: { DB: db }, data: { user: users[user] }, params: { roomId: 'room', sessionId: 'session' } })

it('세션 상태 조회는 권한 확인 뒤 세션·참가자·녹화를 한 단계로 읽는다', async () => {
  const response = await get('host')
  expect(response.status).toBe(200)
  const { session } = await response.json()
  expect(session.id).toBe('session')
  expect(session.members.map((member) => member.userId)).toEqual(['host'])
  // 권한 확인(1) → 세션·참가자·녹화(2). 세션 행을 먼저 기다리면 3단계였다.
  expect(stages).toBe(2)
  stages = 0
  expect((await get('outsider')).status).toBe(403)
})
