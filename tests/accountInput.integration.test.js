import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../server/_lib/gmail.js', () => ({ isGmailConfigured: () => true }))
vi.mock('../server/_lib/emailOutbox.js', () => ({ sendTrackedEmail: vi.fn(async () => ({ id: 'mock-message' })) }))
import { sendTrackedEmail } from '../server/_lib/emailOutbox.js'
import { verifyAccountEmail } from '../server/_lib/accountRecovery.js'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestPost as signup } from '../server/api/signup.js'
import { onRequestPost as login } from '../server/api/login.js'
import { onRequestPost as changePassword } from '../server/api/change-password.js'
import { onRequestPost as adminCreate } from '../server/api/admin/users/index.js'
import { hashPassword, verifyPassword } from '../server/_lib/auth.js'

let db
beforeEach(() => { db = sqliteApp() })
afterEach(() => db.close())
const request = (body) => new Request('https://test.invalid/api/test', { method: 'POST', body: JSON.stringify(body) })
const valid = { email: 'valid@example.invalid', password: 'valid-password', displayName: '테스트', role: 'candidate' }

it.each([123, true, {}, ['x']])('rejects a non-string password instead of creating a weak account: %j', async (password) => {
  const response = await signup({ env: { DB: db }, request: request({ ...valid, password }) })
  expect(response.status).toBe(400)
  expect(db.sql.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(0)
})

it.each([
  { email: {} }, { email: 'not-an-email' }, { email: 'a'.repeat(255) + '@example.invalid' }, { email: 'a\u0000@example.invalid' },
  { displayName: {} }, { displayName: ' ' }, { displayName: 'x'.repeat(101) },
  { companyName: {} }, { password: 'x'.repeat(1025) }, { remember: 'false' },
])('rejects malformed account inputs before database writes: %j', async (override) => {
  expect((await signup({ env: { DB: db }, request: request({ ...valid, ...override }) })).status).toBe(400)
  expect(db.sql.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(0)
})

it('applies the same identity validation to administrator-created accounts', async () => {
  const user = seedUser(db, 'admin', 'company', { admin: 1 })
  expect((await adminCreate({ env: { DB: db }, data: { user }, request: request({ ...valid, email: {}, isRecruiter: 'false' }) })).status).toBe(400)
  expect(db.sql.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(1)
})

it('does not coerce credentials during login or in the password primitives', async () => {
  const { hash, salt } = await hashPassword('123') // A synthetic legacy credential, not a newly registered account.
  const user = seedUser(db, 'legacy')
  db.sql.prepare('UPDATE users SET password_hash=?, password_salt=? WHERE id=?').run(hash, salt, user.id)
  expect((await login({ env: { DB: db }, request: request({ email: user.email, password: 123 }) })).status).toBe(400)
  expect(await verifyPassword(123, hash, salt)).toBe(false)
  await expect(hashPassword(123)).rejects.toThrow()
})

it('keeps signup, login, and password change functional with valid credentials', async () => {
  const signupResponse = await signup({ env: { DB: db }, request: request({ ...valid, email: ' VALID@EXAMPLE.INVALID ', remember: false }) })
  expect(signupResponse.status).toBe(202)
  expect((await signupResponse.json()).verificationRequired).toBe(true)
  const token = sendTrackedEmail.mock.calls.at(-1)[1].text.match(/#token=([A-Za-z0-9_-]{43})/)[1]
  const verified = await verifyAccountEmail({ env: { DB: db }, request: request({ token, password: valid.password }) })
  expect(verified.status).toBe(200)
  expect((await verified.json()).sessionPersistent).toBe(false)
  expect((await login({ env: { DB: db }, request: request({ email: valid.email, password: valid.password }) })).status).toBe(200)
  const user = db.sql.prepare('SELECT * FROM users WHERE email=?').get(valid.email)
  const changed = await changePassword({ env: { DB: db }, data: { user }, request: request({ currentPassword: valid.password, newPassword: 'a-new-password' }) })
  expect(changed.status).toBe(200)
  const stored = db.sql.prepare('SELECT * FROM users WHERE id=?').get(user.id)
  expect(await verifyPassword('a-new-password', stored.password_hash, stored.password_salt)).toBe(true)
})

it('rejects invalid current/new password types and lengths without changing the stored hash', async () => {
  const user = seedUser(db, 'change-user')
  for (const body of [
    { currentPassword: true, newPassword: 'valid-password' },
    { currentPassword: 'valid-password', newPassword: 12345678 },
    { currentPassword: 'valid-password', newPassword: 'x'.repeat(1025) },
  ]) {
    expect((await changePassword({ env: { DB: db }, data: { user }, request: request(body) })).status).toBe(400)
  }
  expect(db.sql.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id).password_hash).toBe('unused')
})
