import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestPost } from '../server/api/rooms/[roomId]/interviews/[sessionId]/signaling.js'
import { CONSENT_NOTICE_VERSION, CONSENT_NOTICE_HASH } from '../server/_lib/interviews.js'
import { kickParticipants, closeMeeting } from '../server/_lib/supabaseRealtime.js'
import { interviewIceServers } from '../server/_lib/turn.js'
let db, users
beforeEach(() => {
  db = sqliteApp()
  users = { host: seedUser(db, 'host', 'company'), candidate: seedUser(db, 'candidate'), outsider: seedUser(db, 'outsider') }
  db.sql.exec(`INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code) VALUES ('room','host','Test','active','ABCD2345EFGH');
    INSERT INTO interview_sessions (id,room_id,provider_meeting_id,title,status) VALUES ('session','room','meeting','Test','live');`)
  for (const role of ['host', 'candidate']) {
    db.sql.prepare(`INSERT INTO interview_session_members (session_id,user_id,role,custom_participant_id,provider_participant_id,admitted_at,signaling_seen_at)
      VALUES ('session', ?, ?, ?, ?, datetime('now'), datetime('now'))`).run(role, role, `custom-${role}`, `peer-${role}`)
    db.sql.prepare(`INSERT INTO interview_recording_consents (session_id,user_id,notice_version,notice_hash,granted)
      VALUES ('session', ?, ?, ?, 1)`).run(role, CONSENT_NOTICE_VERSION, CONSENT_NOTICE_HASH)
  }
})
afterEach(() => { db.close(); vi.unstubAllGlobals() })
const call = (user, body = {}) => onRequestPost({ env: { DB: db }, data: { user: users[user] }, params: { roomId: 'room', sessionId: 'session' },
  request: new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({ action: 'heartbeat', participantId: `peer-${user}`, ...body }) }) })

it('never trusts outsider identity, a forged peer id, or a client claiming host role', async () => {
  expect((await call('outsider', { participantId: 'peer-host', role: 'host' })).status).toBe(403)
  expect((await call('candidate', { participantId: 'peer-host' })).status).toBe(403)
  expect((await call('candidate', { action: 'send', event: 'huddle', payload: { active: true, role: 'host' } })).status).toBe(403)
  expect((await call('host', { action: 'send', event: 'control', payload: { event: 'meeting-ended' } })).status).toBe(403)
})
it('binds the signal sender to the session, delivers only to its admitted recipient', async () => {
  const response = await call('candidate', { action: 'send', event: 'signal', payload: { from: 'peer-host', to: 'peer-host', description: { type: 'offer', sdp: 'v=0' } } })
  expect(response.status).toBe(200)
  const host = await (await call('host')).json()
  expect(host.messages[0].payload.from).toBe('peer-candidate')
  expect((await (await call('candidate')).json()).messages).toHaveLength(0)
  expect((await call('candidate', { action: 'send', event: 'signal', payload: { to: 'foreign-room-peer', description: { type: 'offer', sdp: 'v=0' } } })).status).toBe(403)
})
it('revoked consent, suspension, kick, and meeting termination take effect in the actual signaling path', async () => {
  db.sql.exec("UPDATE interview_recording_consents SET granted = 0 WHERE user_id = 'candidate'")
  expect((await call('candidate')).status).toBe(403)
  db.sql.exec("UPDATE interview_recording_consents SET granted = 1 WHERE user_id = 'candidate'; UPDATE users SET is_suspended = 1 WHERE id = 'candidate'")
  expect((await call('candidate')).status).toBe(403)
  db.sql.exec("UPDATE users SET is_suspended = 0 WHERE id = 'candidate'")
  await kickParticipants({ DB: db }, { meetingId: 'meeting', customParticipantIds: ['custom-candidate'] })
  expect((await call('candidate')).status).toBe(403)
  await closeMeeting({ DB: db }, { meetingId: 'meeting' })
  expect((await call('host')).status).toBe(403)
})
it('issues limited-lifetime TURN credentials without exposing the shared secret', async () => {
  expect((await interviewIceServers({}, 'peer')).relayConfigured).toBe(false)
  const result = await interviewIceServers({ TURN_URLS: 'turn:relay.example.invalid:3478?transport=udp', TURN_SHARED_SECRET: 'synthetic-shared-secret' }, 'peer')
  expect(result.relayConfigured).toBe(true)
  expect(JSON.stringify(result)).not.toContain('synthetic-shared-secret')
  const expiry = Number(result.iceServers[1].username.split(':')[0])
  expect(expiry - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(7199)
})
