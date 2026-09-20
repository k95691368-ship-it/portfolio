import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Live database access is forbidden') } }))
vi.mock('../server/_lib/gmail.js', () => ({ isGmailConfigured: () => true }))
vi.mock('../server/_lib/emailOutbox.js', () => ({ sendTrackedEmail: vi.fn(async () => ({ id: 'mock-message' })) }))
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { sendTrackedEmail } from '../server/_lib/emailOutbox.js'
import { signupAccount, forgotPassword, verifyAccountEmail, resetAccountPassword } from '../server/_lib/accountRecovery.js'
import { onRequestPost as login } from '../server/api/login.js'

let pg, db
const adapter = (client) => ({
  async unsafe(query, values = []) {
    const result = await client.query(query, values)
    return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length })
  },
  begin(operation) { return client.transaction((transaction) => operation(adapter(transaction))) },
})
const body = (email) => ({ email, password: 'valid-password', role: 'candidate', displayName: '지원자', remember: true })
const call = (handler, value) => handler({ env: { DB: db }, request: new Request('https://test.invalid/api/account', {
  method: 'POST', headers: { 'CF-Connecting-IP': value.email || 'local-proof' }, body: JSON.stringify(value),
}) })
const latestToken = () => sendTrackedEmail.mock.calls.at(-1)[1].text.match(/#token=([A-Za-z0-9_-]{43})/)[1]
const deferred = () => {
  let resolve
  const promise = new Promise((ready) => { resolve = ready })
  return { promise, resolve }
}

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT);')
  for (const name of ['202609030001_cloudflare_to_supabase.sql', '202609130001_audit_remediation.sql', '202609190002_account_recovery.sql']) {
    await pg.exec(readFileSync(`supabase/migrations/${name}`, 'utf8'))
  }
  db = new PostgresD1(adapter(pg))
}, 30000)
afterAll(async () => { await pg?.close() })

it('runs the actual migration and PostgreSQL adapter with a private proof table', async () => {
  const response = await call(signupAccount, body('postgres@example.invalid'))
  expect(response.status).toBe(202)
  const token = latestToken()
  expect((await call(verifyAccountEmail, { token, password: 'valid-password' })).status).toBe(200)
  expect((await call(verifyAccountEmail, { token, password: 'valid-password' })).status).toBe(400)
  const { rows } = await pg.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'account_recovery_tokens'")
  expect(rows[0].relrowsecurity).toBe(true)
  for (const role of ['anon', 'authenticated']) {
    const result = await pg.query("SELECT has_table_privilege($1, 'account_recovery_tokens', 'SELECT,INSERT,UPDATE,DELETE') AS allowed", [role])
    expect(result.rows[0].allowed).toBe(false)
  }
})

it('allows one winner for two different reset links issued for the same credential', async () => {
  const email = 'concurrent@example.invalid'
  await call(signupAccount, body(email))
  await call(forgotPassword, { email })
  const first = latestToken()
  await call(forgotPassword, { email })
  const second = latestToken()
  const responses = await Promise.all([first, second].map((token, index) =>
    call(resetAccountPassword, { token, newPassword: `replacement-password-${index}` })))
  expect(responses.map((response) => response.status).sort()).toEqual([200, 400])
})

it('cannot create an old-password session when reset commits after proof lookup but before verification commits', async () => {
  const email = 'race@example.invalid'
  await call(signupAccount, body(email))
  const verifyToken = latestToken()
  await call(forgotPassword, { email })
  const resetToken = latestToken()
  const verificationReachedBatch = deferred()
  const resetFinished = deferred()
  const originalBatch = db.batch.bind(db)
  db.batch = async (statements) => {
    const resetting = statements.some((statement) => statement.source.includes('SET password_hash ='))
    if (resetting) {
      await verificationReachedBatch.promise
      const result = await originalBatch(statements)
      resetFinished.resolve()
      return result
    }
    verificationReachedBatch.resolve()
    await resetFinished.promise
    return originalBatch(statements)
  }
  try {
    const [verified, reset] = await Promise.all([
      call(verifyAccountEmail, { token: verifyToken, password: 'valid-password' }),
      call(resetAccountPassword, { token: resetToken, newPassword: 'replacement-password' }),
    ])
    expect(reset.status).toBe(200)
    expect(verified.status).toBe(400)
    const row = await db.prepare('SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ?').bind(email).first()
    expect(Number(row.n)).toBe(0)
  } finally { db.batch = originalBatch }
})

it('revokes the verification session if password reset runs after verification', async () => {
  const email = 'after-verify@example.invalid'
  await call(signupAccount, body(email))
  const verifyToken = latestToken()
  await call(forgotPassword, { email })
  const resetToken = latestToken()
  expect((await call(verifyAccountEmail, { token: verifyToken, password: 'valid-password' })).status).toBe(200)
  expect((await call(resetAccountPassword, { token: resetToken, newPassword: 'replacement-password' })).status).toBe(200)
  const row = await db.prepare('SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ?').bind(email).first()
  expect(Number(row.n)).toBe(0)
})

it('rejects a login that checked the old password before reset but tries to create its session afterward', async () => {
  const email = 'login-race@example.invalid'
  await call(signupAccount, body(email))
  await call(verifyAccountEmail, { token: latestToken(), password: 'valid-password' })
  await call(forgotPassword, { email })
  const resetToken = latestToken()
  const loginAtBatch = deferred()
  const resetFinished = deferred()
  const originalBatch = db.batch.bind(db)
  db.batch = async (statements) => {
    const resetting = statements.some((statement) => statement.source.includes('SET password_hash = ?'))
    if (resetting) {
      await loginAtBatch.promise
      const result = await originalBatch(statements)
      resetFinished.resolve()
      return result
    }
    loginAtBatch.resolve()
    await resetFinished.promise
    return originalBatch(statements)
  }
  try {
    const [signedIn, reset] = await Promise.all([
      call(login, { email, password: 'valid-password' }),
      call(resetAccountPassword, { token: resetToken, newPassword: 'replacement-password' }),
    ])
    expect(reset.status).toBe(200)
    expect(signedIn.status).toBe(401)
    const row = await db.prepare('SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ?').bind(email).first()
    expect(Number(row.n)).toBe(0)
  } finally { db.batch = originalBatch }
})
