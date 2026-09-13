import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestPut } from '../server/api/rooms/[roomId]/interviews/[sessionId]/recording/[recordingId]/control.js'
import { onRequestGet } from '../server/api/rooms/[roomId]/interviews/[sessionId]/recordings/[recordingId]/file.js'

let db, host, storage
beforeEach(() => {
  db = sqliteApp(); host = seedUser(db, 'host', 'company')
  storage = { delete: vi.fn(), get: vi.fn() }
  db.sql.exec(`INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code) VALUES ('room','host','Test','active','ABCD2345EFGH');
    INSERT INTO room_participants (room_id,user_id,role_in_room) VALUES ('room','host','company');
    INSERT INTO interview_sessions (id,room_id,provider_meeting_id,title,status) VALUES ('session','room','meeting','Test','live');
    INSERT INTO interview_session_members (session_id,user_id,role,custom_participant_id) VALUES ('session','host','host','custom-host');
    INSERT INTO interview_recordings (id,session_id,status,storage_status,r2_key,created_by_user_id) VALUES ('recording','session','recording','pending','recording.webm','host');`)
})
afterEach(() => db.close())
const context = (action) => ({ env: { DB: db, INTERVIEW_RECORDINGS: storage }, data: { user: host },
  params: { roomId: 'room', sessionId: 'session', recordingId: 'recording' },
  request: new Request('https://test.invalid/api/file', action ? { method: 'PUT', body: JSON.stringify({ action }) } : {}),
})
it('clears a failed browser start, but never aborts an already stored recording', async () => {
  expect((await onRequestPut(context('abort'))).status).toBe(200)
  expect(db.sql.prepare('SELECT status FROM interview_recordings').get().status).toBe('failed')
  db.sql.exec("UPDATE interview_recordings SET status = 'available', storage_status = 'stored'")
  expect((await onRequestPut(context('abort'))).status).toBe(403)
  expect(storage.delete).not.toHaveBeenCalled()
})
it('expired file GET denies access without falsely deleting held storage', async () => {
  db.sql.exec("UPDATE interview_recordings SET status = 'available', storage_status = 'stored', retention_until = datetime('now','-1 day'), retention_hold_reason = 'Dispute preservation'")
  expect((await onRequestGet(context())).status).toBe(410)
  expect(storage.delete).not.toHaveBeenCalled()
  expect(storage.get).not.toHaveBeenCalled()
  expect(db.sql.prepare('SELECT r2_key, deleted_at FROM interview_recordings').get()).toMatchObject({ r2_key: 'recording.webm', deleted_at: null })
})
