import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { serializeSession } from '../server/_lib/interviews.js'
import { normalizeSession } from '../src/features/interview/sessionModel.js'
import { onRequestGet as getDetail } from '../server/api/rooms/[roomId]/interviews/[sessionId]/index.js'
import { onRequestGet as getList } from '../server/api/rooms/[roomId]/interviews/index.js'
import { onRequestPut as controlRecording } from '../server/api/rooms/[roomId]/interviews/[sessionId]/recording/[recordingId]/control.js'

let db, users
beforeEach(() => {
  db = sqliteApp()
  users = {
    host: seedUser(db, 'host', 'company'),
    interviewer: seedUser(db, 'interviewer', 'company'),
    candidate: seedUser(db, 'candidate'),
  }
  db.sql.exec(`
    INSERT INTO interview_rooms (id, company_user_id, title, status, invite_code)
      VALUES ('room', 'host', 'Test', 'active', 'ABCD2345EFGH');
    INSERT INTO room_participants (room_id, user_id, role_in_room)
      VALUES ('room', 'host', 'company'), ('room', 'interviewer', 'company'), ('room', 'candidate', 'candidate');
    INSERT INTO interview_sessions (id, room_id, provider_meeting_id, title, status, recording_required)
      VALUES ('session', 'room', 'meeting', 'Test', 'live', 1);
    INSERT INTO interview_recordings (id, session_id, status, storage_status, r2_key, created_by_user_id)
      VALUES ('recording', 'session', 'paused', 'pending', 'fixture.webm', 'host');
  `)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External requests forbidden') }))
})
afterEach(() => { db.close(); vi.unstubAllGlobals() })

const context = (user = 'host') => ({
  env: { DB: db }, data: { user: users[user] },
  params: { roomId: 'room', sessionId: 'session', recordingId: 'recording' },
})
const addMember = (user, role) => db.sql.prepare(`
  INSERT INTO interview_session_members (session_id, user_id, role, custom_participant_id)
    VALUES ('session', ?, ?, ?)
`).run(user, role, `custom-${user}`)

async function readBoth(user = 'host') {
  const responses = await Promise.all([getDetail(context(user)), getList(context(user))])
  expect(responses.map(response => response.status)).toEqual([200, 200])
  const [detail, list] = await Promise.all(responses.map(response => response.json()))
  return [detail.session, list.sessions[0], list.latestSession]
}

it('keeps room-owner display authority separate from recording control without session membership', async () => {
  for (const session of await readBoth()) {
    expect(session).toMatchObject({
      id: 'session', myRole: 'host', canManage: true,
      permissions: { canControlRecording: false },
    })
    expect(normalizeSession({ session }).canControlRecording).toBe(false)
  }
  const denied = await controlRecording({
    ...context(),
    request: new Request('https://test.invalid/control', { method: 'PUT', body: JSON.stringify({ action: 'resume' }) }),
  })
  expect(denied.status).toBe(403)
  expect(db.sql.prepare('SELECT status FROM interview_recordings').get().status).toBe('paused')
  expect(fetch).not.toHaveBeenCalled()
})

it('reports recording authority in detail and list only for an actual session host', async () => {
  addMember('host', 'host')
  for (const session of await readBoth()) {
    expect(session).toMatchObject({ myRole: 'host', canManage: true, permissions: { canControlRecording: true } })
    expect(normalizeSession({ session }).canControlRecording).toBe(true)
  }
})

it('removes recording authority after the session host is demoted despite room ownership', async () => {
  addMember('host', 'host')
  expect((await readBoth())[0].permissions.canControlRecording).toBe(true)
  db.sql.exec("UPDATE interview_session_members SET role = 'interviewer' WHERE user_id = 'host'")
  for (const session of await readBoth()) {
    expect(session).toMatchObject({ myRole: 'interviewer', canManage: false, permissions: { canControlRecording: false } })
  }
})

it.each(['interviewer', 'candidate'])('keeps an actual %s membership outside recording control', async role => {
  addMember(role, role)
  for (const session of await readBoth(role)) {
    expect(session).toMatchObject({ myRole: role, canManage: false, permissions: { canControlRecording: false } })
  }
})

it.each([['host', true], ['interviewer', false], ['candidate', false], [null, false], ['company', false]])(
  'defaults recording control to the actual serializer membership role %s', (myRole, allowed) => {
    expect(serializeSession({ my_role: myRole }).permissions.canControlRecording).toBe(allowed)
  }
)

it('allows an explicit denial for a displayed host and never elevates other roles with an override', () => {
  expect(serializeSession({ my_role: 'host' }, { canControlRecording: false })).toMatchObject({
    myRole: 'host', canManage: true, permissions: { canControlRecording: false },
  })
  expect(serializeSession({ my_role: 'host' }, { canControlRecording: 'true' }).permissions.canControlRecording).toBe(false)
  expect(serializeSession({ my_role: 'interviewer' }, { canControlRecording: true }).permissions.canControlRecording).toBe(false)
})
