import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
vi.mock('../server/_lib/gmail.js', () => ({ isGmailConfigured: vi.fn(() => true) }))
vi.mock('../server/_lib/emailOutbox.js', () => ({ sendTrackedEmail: vi.fn(async () => ({ id: 'mock-message' })) }))
import { isGmailConfigured } from '../server/_lib/gmail.js'
import { sendTrackedEmail } from '../server/_lib/emailOutbox.js'
import { signupAccount, resendVerification, correctPendingEmail, forgotPassword, verifyAccountEmail, resetAccountPassword, recoveryTokenHash } from '../server/_lib/accountRecovery.js'
import { hashPassword, verifyPassword, createSession, getSessionUser, getRoomSessionUser } from '../server/_lib/auth.js'
import { onRequestPost as login } from '../server/api/login.js'

let db
const profile = { email: 'member@example.invalid', password: 'valid-password', displayName: '지원자', role: 'candidate', remember: false }
const call = (handler, body) => handler({ env: { DB: db }, request: new Request('https://hostile.invalid/api/account', {
  method: 'POST', headers: { 'CF-Connecting-IP': 'local-test', Origin: 'https://hostile.invalid' }, body: JSON.stringify(body),
}) })
const latestToken = () => sendTrackedEmail.mock.calls.at(-1)?.[1].text.match(/#token=([A-Za-z0-9_-]{43})/)[1]
async function legacy(id = 'legacy', email = 'legacy@example.invalid') {
  const user = seedUser(db, id, 'candidate', { email })
  const { hash, salt } = await hashPassword(profile.password)
  await db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').bind(hash, salt, user.id).run()
  return user
}
beforeEach(() => { db = sqliteApp(); vi.clearAllMocks(); isGmailConfigured.mockReturnValue(true) })
afterEach(() => db.close())

it('creates a pending signup without a session; requires inbox and password proof before login', async () => {
  const response = await call(signupAccount, profile)
  expect(response.status).toBe(202)
  expect(await response.json()).toMatchObject({ verificationRequired: true, email: profile.email })
  expect(response.headers.get('Set-Cookie')).toBeNull()
  expect(db.sql.prepare('SELECT COUNT(*) n FROM sessions').get().n).toBe(0)
  expect(db.sql.prepare('SELECT account_status,email_verified_at FROM users').get()).toMatchObject({ account_status: 'pending', email_verified_at: null })
  expect((await call(login, profile)).status).toBe(403)
  const token = latestToken()
  expect((await call(verifyAccountEmail, { token, password: 'wrong-password' })).status).toBe(400)
  const verified = await call(verifyAccountEmail, { token, password: profile.password })
  expect(verified.status).toBe(200)
  expect(await verified.json()).toMatchObject({ emailVerified: true, sessionPersistent: false, email: profile.email })
  expect((await call(login, profile)).status).toBe(200)
  expect((await call(verifyAccountEmail, { token, password: profile.password })).status).toBe(400)
})

it('stores only a token hash and sends a fixed-origin fragment link without credentials or redirects', async () => {
  await call(signupAccount, { ...profile, redirectTo: 'https://hostile.invalid' })
  const token = latestToken()
  const row = db.sql.prepare('SELECT * FROM account_recovery_tokens').get()
  expect(row.token_hash).toBe(await recoveryTokenHash(token))
  expect(JSON.stringify(row)).not.toContain(token)
  expect(JSON.stringify(row)).not.toContain(profile.password)
  const email = sendTrackedEmail.mock.calls[0][1]
  expect(email.text).toContain('https://portfolio-epa.pages.dev/verify-email#token=')
  expect(email.html).toContain('href="https://portfolio-epa.pages.dev/verify-email#token=')
  expect(email.text).not.toContain('hostile.invalid')
  expect(email.text).not.toContain(profile.password)
})

it('keeps old accounts active without inventing email verification', async () => {
  const user = await legacy()
  const response = await call(login, { email: user.email, password: profile.password })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ emailVerified: false })
  expect(db.sql.prepare('SELECT email_verified_at,account_status FROM users').get()).toMatchObject({ email_verified_at: null, account_status: 'active' })
})

it('requires password proof to resend or correct a pending address and invalidates old links', async () => {
  await call(signupAccount, profile)
  const oldToken = latestToken()
  await call(correctPendingEmail, { email: profile.email, newEmail: 'correct@example.invalid', password: 'wrong' })
  expect(db.sql.prepare('SELECT email FROM users').get().email).toBe(profile.email)
  expect(sendTrackedEmail).toHaveBeenCalledTimes(1)
  await call(correctPendingEmail, { email: profile.email, newEmail: 'correct@example.invalid', password: profile.password })
  const newToken = latestToken()
  expect(db.sql.prepare('SELECT email FROM users').get().email).toBe('correct@example.invalid')
  expect((await call(verifyAccountEmail, { token: oldToken, password: profile.password })).status).toBe(400)
  expect((await call(verifyAccountEmail, { token: newToken, password: profile.password })).status).toBe(200)
  await call(correctPendingEmail, { email: 'correct@example.invalid', newEmail: 'takeover@example.invalid', password: profile.password })
  expect(db.sql.prepare('SELECT email FROM users').get().email).toBe('correct@example.invalid')
})

it('never overwrites another existing email or password when a pending user corrects an address', async () => {
  const existing = await legacy()
  await call(signupAccount, profile)
  await call(correctPendingEmail, { email: profile.email, newEmail: existing.email, password: profile.password })
  expect(db.sql.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(2)
  expect(db.sql.prepare('SELECT email FROM users WHERE account_status = ?').get('pending').email).toBe(profile.email)
})

it('uses identical request replies for missing, existing, suspended, trial, and rate-limited accounts', async () => {
  const user = await legacy()
  const replies = []
  for (const email of ['missing@example.invalid', user.email, 'trial@trial.invalid']) {
    if (email.endsWith('@trial.invalid')) await legacy('trial', email)
    const response = await call(forgotPassword, { email })
    replies.push([response.status, await response.json()])
  }
  await db.prepare('UPDATE users SET is_suspended = 1 WHERE id = ?').bind(user.id).run()
  for (let i = 0; i < 7; i++) {
    const response = await call(forgotPassword, { email: user.email })
    replies.push([response.status, await response.json()])
  }
  expect(replies.every((reply) => JSON.stringify(reply) === JSON.stringify(replies[0]))).toBe(true)
  expect(sendTrackedEmail).toHaveBeenCalledTimes(1)
})

it('resets an unverified legacy account with inbox proof and revokes account and invite sessions', async () => {
  const user = await legacy()
  const account = await createSession(db, user.id)
  const room = await createSession(db, user.id, { authMethod: 'invite_code', scopedRoomId: 'one-room' })
  await call(forgotPassword, { email: user.email })
  const token = latestToken()
  const response = await call(resetAccountPassword, { token, newPassword: 'replacement-password' })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
  expect(db.sql.prepare('SELECT COUNT(*) n FROM sessions').get().n).toBe(0)
  const saved = db.sql.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
  expect(await verifyPassword('replacement-password', saved.password_hash, saved.password_salt)).toBe(true)
  expect(saved.email_verified_at).toBeTruthy()
  const request = new Request('https://test.invalid', { headers: { 'X-App-Authorization': `Bearer ${account.token}`, 'X-Room-Authorization': `Bearer ${room.token}` } })
  expect(await getSessionUser(db, request)).toBeNull()
  expect(await getRoomSessionUser(db, request, 'one-room')).toBeNull()
  expect((await call(resetAccountPassword, { token, newPassword: 'another-password' })).status).toBe(400)
})

it('rejects wrong-purpose, expired, and superseded credential links', async () => {
  await call(signupAccount, profile)
  const verification = latestToken()
  expect((await call(resetAccountPassword, { token: verification, newPassword: 'replacement-password' })).status).toBe(400)
  await db.prepare("UPDATE account_recovery_tokens SET expires_at = datetime('now','-1 minute')").run()
  expect((await call(verifyAccountEmail, { token: verification, password: profile.password })).status).toBe(400)
  await call(forgotPassword, { email: profile.email })
  const reset = latestToken()
  const { hash, salt } = await hashPassword('changed-elsewhere')
  await db.prepare('UPDATE users SET password_hash = ?, password_salt = ?').bind(hash, salt).run()
  expect((await call(resetAccountPassword, { token: reset, newPassword: 'replacement-password' })).status).toBe(400)
})

it('allows only one successful concurrent redemption of the same link', async () => {
  await legacy()
  await call(forgotPassword, { email: 'legacy@example.invalid' })
  const token = latestToken()
  const responses = await Promise.all([1, 2].map((n) => call(resetAccountPassword, { token, newPassword: `replacement-password-${n}` })))
  expect(responses.map((response) => response.status).sort()).toEqual([200, 400])
})

it('does not activate a pending account through an existing account or room session', async () => {
  await call(signupAccount, profile)
  const { id } = db.sql.prepare('SELECT id FROM users').get()
  const account = await createSession(db, id)
  const room = await createSession(db, id, { authMethod: 'invite_code', scopedRoomId: 'one-room' })
  const request = new Request('https://test.invalid', { headers: { 'X-App-Authorization': `Bearer ${account.token}`, 'X-Room-Authorization': `Bearer ${room.token}` } })
  expect(await getSessionUser(db, request)).toBeNull()
  expect(await getRoomSessionUser(db, request, 'one-room')).toBeNull()
})

it('does not create an unusable signup when mail is unconfigured and keeps delivery errors generic', async () => {
  isGmailConfigured.mockReturnValue(false)
  expect((await call(signupAccount, profile)).status).toBe(503)
  expect(db.sql.prepare('SELECT COUNT(*) n FROM users').get().n).toBe(0)
  isGmailConfigured.mockReturnValue(true)
  sendTrackedEmail.mockRejectedValueOnce(new Error('Private provider details'))
  const response = await call(signupAccount, profile)
  expect(response.status).toBe(202)
  expect(JSON.stringify(await response.json())).not.toContain('Private provider')
  await call(resendVerification, { email: profile.email, password: profile.password })
  expect(sendTrackedEmail).toHaveBeenCalledTimes(2)
})
