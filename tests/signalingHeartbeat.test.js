import { afterEach, beforeEach, expect, it } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestPost } from '../server/api/rooms/[roomId]/interviews/[sessionId]/signaling.js'
import { CONSENT_NOTICE_VERSION, CONSENT_NOTICE_HASH } from '../server/_lib/interviews.js'

// 참가자마다 1초에 한 번 오는 heartbeat 는 내 접속 시각 기록과 받은 신호 조회를 함께 보낸다.
// 질의마다 같은 지연을 주고, 받은 신호 조회가 시작될 때 기록이 아직 진행 중인지 본다.
let db, users, active, overlapped
beforeEach(() => {
  db = sqliteApp()
  users = { host: seedUser(db, 'host', 'company'), candidate: seedUser(db, 'candidate') }
  db.sql.exec(`INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code) VALUES ('room','host','Test','active','ABCD2345EFGH');
    INSERT INTO interview_sessions (id,room_id,provider_meeting_id,title,status) VALUES ('session','room','meeting','Test','live');`)
  for (const role of ['host', 'candidate']) {
    db.sql.prepare(`INSERT INTO interview_session_members (session_id,user_id,role,custom_participant_id,provider_participant_id,admitted_at,signaling_seen_at)
      VALUES ('session', ?, ?, ?, ?, datetime('now'), datetime('now'))`).run(role, role, `custom-${role}`, `peer-${role}`)
    db.sql.prepare(`INSERT INTO interview_recording_consents (session_id,user_id,notice_version,notice_hash,granted)
      VALUES ('session', ?, ?, ?, 1)`).run(role, CONSENT_NOTICE_VERSION, CONSENT_NOTICE_HASH)
  }
  active = new Set()
  overlapped = false
  const prepare = db.prepare.bind(db)
  db.prepare = (source) => {
    const statement = prepare(source)
    const bind = statement.bind.bind(statement)
    statement.bind = (...values) => {
      const bound = bind(...values)
      for (const method of ['first', 'all', 'run']) {
        const original = bound[method].bind(bound)
        bound[method] = async () => {
          if (/FROM interview_signals/.test(source) && [...active].some((sql) => /signaling_seen_at = datetime/.test(sql))) overlapped = true
          active.add(source)
          try {
            await new Promise((resolve) => setTimeout(resolve, 10))
            return await original()
          } finally { active.delete(source) }
        }
      }
      return bound
    }
    return statement
  }
})
afterEach(() => { db.close() })
const call = (user, body = {}) => onRequestPost({ env: { DB: db }, data: { user: users[user] }, params: { roomId: 'room', sessionId: 'session' },
  request: new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({ action: 'heartbeat', participantId: `peer-${user}`, ...body }) }) })

it('heartbeat 는 접속 시각 기록과 받은 신호 조회를 함께 보내고, 결과는 그대로다', async () => {
  const sent = await call('candidate', { action: 'send', event: 'signal', payload: { to: 'peer-host', description: { type: 'offer', sdp: 'v=0' } } })
  expect(sent.status).toBe(200)
  overlapped = false
  const response = await call('host')
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.messages.map((message) => message.payload.from)).toEqual(['peer-candidate'])
  expect(body.members.map((member) => member.participantId).sort()).toEqual(['peer-candidate', 'peer-host'])
  expect(overlapped).toBe(true)
  const seen = db.sql.prepare("SELECT signaling_seen_at FROM interview_session_members WHERE user_id = 'host'").get()
  expect(seen.signaling_seen_at).toBeTruthy()
})
