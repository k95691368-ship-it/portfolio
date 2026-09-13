import { describe, it, expect, vi, afterEach } from 'vitest'
import { applyTrialCapabilities, isProtectedDeveloper, TRIAL_SECONDS } from '../server/_lib/developerTrial.js'
import { createSession, needsRenewal } from '../server/_lib/auth.js'
import { onRequestPost as start } from '../server/api/demo/login.js'
import { onRequestPost as changePassword } from '../server/api/change-password.js'
import { onRequestPatch, onRequestDelete } from '../server/api/admin/users/[id]/index.js'
import { onRequestPost as resetPassword } from '../server/api/admin/users/[id]/reset-password.js'
import { onRequestGet as listUsers } from '../server/api/admin/users/index.js'
import { onRequestPost as createPosting } from '../server/api/postings/index.js'
import { EXAMPLE_POSTING } from '../shared/jobPostingTemplate.js'

const request = (body, method = 'POST') => new Request('https://test.invalid/api/demo/login', {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
function fakeDb(target = null, count = 0) {
  const writes = []
  return { writes, prepare(sql) {
    let args = []
    const st = {
      bind(...values) { args = values; return st },
      async run() { writes.push({ sql, args }); return { meta: { changes: sql.includes('INSERT INTO rate_limit_hits') && count >= args[2] ? 0 : 1, last_row_id: 1 } } },
      async first() { return sql.includes('COUNT(*)') ? { count } : target },
      async all() { return { results: [target, { id: 'trial', email: 'trial@trial.invalid' }].filter(Boolean) } },
    }
    return st
  } }
}
const trial = (extra = {}) => ({ id: 'trial', email: 'trial@trial.invalid', is_developer: 0,
  session_auth_method: 'developer_trial', session_started_at: '2026-09-12 00:00:00',
  session_expires_at: '2026-09-12T01:00:00.000Z', ...extra })
afterEach(() => vi.useRealTimers())

describe('one-hour developer trial', () => {
  it('grants virtual privileges only within the original UTC hour', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T00:30:00Z'))
    const original = trial()
    expect(applyTrialCapabilities(original)).toMatchObject({ developer_trial: true, is_admin: 0, is_recruiter: 1, is_developer: 0 })
    expect(original.is_developer).toBe(0)
    expect(needsRenewal(original)).toBe(false)
    vi.setSystemTime(new Date('2026-09-12T01:00:00Z'))
    expect(applyTrialCapabilities(original)).toBeNull()
  })
  it.each([
    { email: 'k95691368@gmail.com' }, { is_developer: 1 }, { email: 'real@example.com' },
    { session_expires_at: '2026-09-13T01:00:00Z' }, { session_started_at: 'invalid' },
    { session_started_at: '2026-09-12T00:45:00Z' },
  ])('rejects malformed or protected trial identity %j', (extra) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-12T00:30:00Z'))
    expect(applyTrialCapabilities(trial(extra))).toBeNull()
  })
  it('does not change normal accounts and protects owner even without its flag', () => {
    const owner = { email: ' K95691368@GMAIL.COM ', is_developer: 0 }
    expect(isProtectedDeveloper(owner)).toBe(true)
    expect(applyTrialCapabilities(owner)).toBe(owner)
  })
  it('creates a session lasting exactly 3600 seconds', async () => {
    const now = Date.now()
    const result = await createSession(fakeDb(), 'trial', { authMethod: 'developer_trial' })
    expect(Date.parse(result.expiresAt) - now).toBeGreaterThanOrEqual(TRIAL_SECONDS * 1000)
    expect(Date.parse(result.expiresAt) - now).toBeLessThan(TRIAL_SECONDS * 1000 + 1000)
  })
  it('creates a fresh unprivileged account; does not expose its password', async () => {
    const db = fakeDb()
    const res = await start({ request: request({ role: 'developer' }), env: { DB: db } })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ developerTrial: true, isAdmin: false, isRecruiter: true, isDeveloper: false })
    expect(body.email).toMatch(/@trial\.invalid$/)
    expect(body).not.toHaveProperty('password')
    expect(body).not.toHaveProperty('password_hash')
    expect(res.headers.get('Set-Cookie')).not.toContain('Max-Age')
    expect(db.writes.find(w => w.sql.includes('INSERT INTO users')).sql).toContain("'체험', 0, 0, 0")
  })
  it.each([{ role: 'company' }, { role: 'admin' }, { role: 'developer', email: 'k95691368@gmail.com' }])('rejects caller-selected identity %j', async body => {
    const db = fakeDb()
    expect((await start({ request: request(body), env: { DB: db } })).status).toBe(400)
    expect(db.writes).toHaveLength(0)
  })
  it('does not overwrite a logged-in account or extend an existing trial', async () => {
    expect((await start({ data: { user: { id: 'owner' } } })).status).toBe(409)
    const res = await start({ data: { user: { ...trial(), developer_trial: true } } })
    expect((await res.json()).trialExpiresAt).toBe(trial().session_expires_at)
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })
  it('rate limits new trials', async () => {
    expect((await start({ request: request({ role: 'developer' }), env: { DB: fakeDb(null, 3) } })).status).toBe(429)
  })
  it('cannot convert the trial into a password session', async () => {
    expect((await changePassword({ data: { user: { developer_trial: true } } })).status).toBe(403)
  })
  it('hides owner from account administration and blocks all owner mutations', async () => {
    const db = fakeDb({ id: 'owner', email: 'k95691368@gmail.com', is_developer: 0 })
    const ctx = { env: { DB: db }, data: { user: { id: 'trial', developer_trial: true, is_developer: 1 } }, params: { id: 'owner' }, request: request({ isSuspended: true }, 'PATCH') }
    expect((await (await listUsers(ctx)).json()).users.map(u => u.id)).toEqual(['trial'])
    expect((await onRequestPatch(ctx)).status).toBe(403)
    expect((await onRequestDelete(ctx)).status).toBe(403)
    expect((await resetPassword(ctx)).status).toBe(403)
    expect(db.writes).toHaveLength(0)
  })
  it('uses the real posting write path with emoji intact', async () => {
    const db = fakeDb()
    const res = await createPosting({ env: { DB: db }, data: { user: { id: 'trial', role: 'company', is_admin: 1, developer_trial: true } }, request: request(EXAMPLE_POSTING) })
    expect(res.status).toBe(201)
    expect(db.writes.find(w => w.sql.includes('INSERT INTO job_postings')).args).toContain(EXAMPLE_POSTING.description)
  })
})
