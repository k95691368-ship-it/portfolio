import { describe, it, expect, afterEach } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { createSession, getSessionUser, getRoomSessionUser, renewSessionIfStale } from '../server/_lib/auth.js'
import { onRequest as middleware } from '../server/api/_middleware.js'
import { onRequest as adminMiddleware } from '../server/api/admin/_middleware.js'
import { applyTrialCapabilities } from '../server/_lib/developerTrial.js'
import { canManagePosting } from '../server/_lib/recruiter.js'
import { onRequestPost as claim } from '../server/api/applications/claim.js'
import { onRequestPost as pass } from '../server/api/applications/[id]/pass.js'

let db
afterEach(() => db?.close())
const req = (token, header = 'X-App-Authorization') => new Request('https://test.invalid/api/me', { headers: { [header]: `Bearer ${token}` } })
describe('actual SQL security regressions', () => {
  it('room token never authenticates a general API or another room and cannot renew', async () => {
    db = sqliteApp(); seedUser(db, 'candidate')
    const session = await createSession(db, 'candidate', { authMethod: 'invite_code', scopedRoomId: 'room-a' })
    expect(await getSessionUser(db, req(session.token))).toBeNull()
    expect(await getRoomSessionUser(db, req(session.token, 'X-Room-Authorization'), 'room-b')).toBeNull()
    expect((await getRoomSessionUser(db, req(session.token, 'X-Room-Authorization'), 'room-a')).id).toBe('candidate')
    expect(await renewSessionIfStale(db, req(session.token))).toBeNull()
  })
  it('trial cannot enter any admin route or manage another owner, but manages its own real posting', async () => {
    db = sqliteApp(); seedUser(db, 'trial', 'company', { email: 'trial@trial.invalid' })
    const session = await createSession(db, 'trial', { authMethod: 'developer_trial' })
    const user = await getSessionUser(db, req(session.token))
    expect(user.is_admin).toBe(0); expect(user.is_developer).toBe(0)
    expect((await adminMiddleware({ data: { user }, next: () => { throw new Error('admin reached') } })).status).toBe(403)
    expect(canManagePosting(user, { created_by_user_id: 'other' })).toBe(false)
    expect(canManagePosting(user, { created_by_user_id: 'trial' })).toBe(true)
    expect(applyTrialCapabilities({ ...user, is_developer: 0, session_expires_at: new Date(Date.now() - 1).toISOString() })).toBeNull()
  })
  it('renewal responds with the exact persisted expiry, not just a stripped cookie', async () => {
    db = sqliteApp(); seedUser(db, 'candidate')
    const { token } = await createSession(db, 'candidate')
    db.sql.exec("UPDATE sessions SET created_at = datetime('now','-20 days'), expires_at = datetime('now','+10 days')")
    const response = await middleware({ env: { DB: db }, request: req(token), data: {}, next: async () => Response.json({ ok: true }) })
    const saved = db.sql.prepare('SELECT expires_at FROM sessions').get()
    expect(response.headers.get('X-App-Session-Expires-At')).toBe(saved.expires_at)
    expect(Date.parse(saved.expires_at)).toBeGreaterThan(Date.now() + 29 * 86400000)
  })
  it('approval does not attach an unproved account with the same email; lookup proof enables it', async () => {
    db = sqliteApp()
    const owner = seedUser(db, 'owner', 'company', { recruiter: 1 })
    const candidate = seedUser(db, 'candidate')
    db.sql.exec("INSERT INTO job_postings (id,title,description,created_by_user_id,status) VALUES ('posting','Role','Details','owner','open')")
    db.sql.exec("INSERT INTO applications (id,posting_id,applicant_name,applicant_email,applicant_phone,consent_required,lookup_code) VALUES ('app','posting','Name','candidate@example.invalid','01012345678',1,'ABCD2345EF')")
    expect((await pass({ env: { DB: db }, data: { user: owner }, params: { id: 'app' } })).status).toBe(409)
    const callClaim = (code) => claim({ env: { DB: db }, data: { user: candidate }, request: new Request('https://test.invalid/api/applications/claim', { method: 'POST', body: JSON.stringify({ code }) }) })
    expect((await callClaim('ZZZZ2345EF')).status).toBe(409)
    expect((await callClaim('ABCD2345EF')).status).toBe(200)
    expect(db.sql.prepare('SELECT created_user_id FROM applications').get().created_user_id).toBe(candidate.id)
    const result = await pass({ env: { DB: db }, data: { user: owner }, params: { id: 'app' } })
    expect(result.status).toBe(201)
    expect(db.sql.prepare('SELECT count(*) n FROM room_participants').get().n).toBe(2)
  })
})
