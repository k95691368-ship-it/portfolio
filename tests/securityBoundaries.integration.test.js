import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { createSession, parseCookie } from '../server/_lib/auth.js'
import { onRequest as middleware } from '../server/api/_middleware.js'
import { onRequestPost as storeContract } from '../server/api/rooms/[roomId]/signed-contract.js'
import { onRequestGet as readMessages, onRequestPost as sendMessage } from '../server/api/rooms/[roomId]/messages.js'
import { onRequestPost as createRoom } from '../server/api/rooms/create.js'
import { onRequestPost as joinRoom } from '../server/api/rooms/join.js'
import { onRequestPost as createPosting } from '../server/api/postings/index.js'
import { onRequestPatch as updatePosting } from '../server/api/postings/[id]/index.js'

let db, company, candidate, env
beforeEach(() => {
  db = sqliteApp()
  company = seedUser(db, 'company', 'company')
  candidate = seedUser(db, 'candidate')
  env = { DB: db, EMAIL_ENABLED: '0', DOCUMENTS: { put: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}) } }
  db.sql.exec(`INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code) VALUES ('room','company','Interview','signed','ABCD2345EFGH');
    INSERT INTO room_participants (room_id,user_id,role_in_room) VALUES ('room','company','company'),('room','candidate','candidate');`)
})
afterEach(() => { db.close(); vi.restoreAllMocks() })
const context = (request, user = company) => ({ env, request, data: { user }, params: { roomId: 'room' } })
const jsonRequest = (path, body) => new Request(`https://test.invalid/api/${path}`, { method: 'POST', body: JSON.stringify(body) })

it.each(['missing', 'expired', 'other-room', 'suspended'])('never falls back to the company when explicit code identity is %s', async (kind) => {
  const account = await createSession(db, company.id)
  const room = await createSession(db, candidate.id, { authMethod: 'invite_code', scopedRoomId: kind === 'other-room' ? 'elsewhere' : 'room' })
  if (kind === 'expired') db.sql.exec("UPDATE sessions SET expires_at = datetime('now','-1 day') WHERE user_id = 'candidate'")
  if (kind === 'suspended') db.sql.exec("UPDATE users SET is_suspended = 1 WHERE id = 'candidate'")
  const request = new Request('https://test.invalid/api/rooms/room/messages', { headers: {
    'X-App-Authorization': `Bearer ${account.token}`, 'X-Room-Identity': 'code',
    ...(kind === 'missing' ? {} : { 'X-Room-Authorization': `Bearer ${room.token}` }),
  } })
  const ctx = { env, request, data: {}, next: vi.fn(() => Response.json({ ok: true })) }
  expect((await middleware(ctx)).status).toBe(401)
  expect(ctx.next).not.toHaveBeenCalled()
})

it('returns 503, not another identity, if the room session lookup fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const request = new Request('https://test.invalid/api/rooms/room/view', { headers: { 'X-Room-Identity': 'code', 'X-Room-Authorization': 'Bearer test-token' } })
  const next = vi.fn()
  const broken = { DB: { prepare() { throw new Error('database unavailable') } } }
  expect((await middleware({ env: broken, request, data: {}, next })).status).toBe(503)
  expect(next).not.toHaveBeenCalled()
})

it('treats malformed cookies as unauthenticated instead of throwing', () => {
  const request = new Request('https://test.invalid', { headers: { Cookie: 'session=%E0%A4%A' } })
  expect(parseCookie(request, 'session')).toBeNull()
})

it.each(['', '<html>not a PDF</html>'])('rejects an invalid contract before storage or notification', async (bytes) => {
  const form = new FormData(); form.set('pdf', new Blob([bytes], { type: 'application/pdf' }), 'contract.pdf')
  const request = new Request('https://test.invalid/api/rooms/room/signed-contract', { method: 'POST', body: form })
  expect((await storeContract(context(request))).status).toBe(400)
  expect(env.DOCUMENTS.put).not.toHaveBeenCalled()
  expect(db.sql.prepare('SELECT count(*) n FROM signed_contracts').get().n).toBe(0)
  expect(db.sql.prepare('SELECT count(*) n FROM notifications').get().n).toBe(0)
})

it('uses unique storage keys even when two saves start in the same millisecond', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
  for (let i = 0; i < 2; i++) {
    const form = new FormData(); form.set('pdf', new Blob(['%PDF-1.7\n%%EOF']), 'contract.pdf')
    expect((await storeContract(context(new Request('https://test.invalid/api/rooms/room/signed-contract', { method: 'POST', body: form })))).status).toBe(201)
  }
  const keys = env.DOCUMENTS.put.mock.calls.map(([key]) => key)
  expect(new Set(keys).size).toBe(2)
})

it.each([42, {}, [], true])('rejects non-text inputs without throwing: %j', async (value) => {
  expect((await createRoom(context(jsonRequest('rooms/create', { title: value })))).status).toBe(400)
  expect((await joinRoom(context(jsonRequest('rooms/join', { inviteCode: value }), candidate))).status).toBe(400)
  expect((await sendMessage(context(jsonRequest('rooms/room/messages', { body: value })))).status).toBe(400)
})

it.each(['NaN', 'Infinity', '-1', '1.5', '9223372036854775808'])('rejects invalid chat cursors before SQL: %s', async (after) => {
  const request = new Request(`https://test.invalid/api/rooms/room/messages?after=${after}`)
  expect((await readMessages(context(request))).status).toBe(400)
})

async function postingFixture() {
  company.is_recruiter = 1
  const response = await createPosting(context(jsonRequest('postings', { title: 'Original', description: 'Description' })))
  expect(response.status).toBe(201)
  return (await response.json()).id
}

it.each([42, {}, [], true])('rejects non-text posting fields on create and update: %j', async (value) => {
  const id = await postingFixture()
  for (const field of ['title', 'description', 'department', 'employmentType', 'location', 'deadline']) {
    const body = { title: 'Valid', description: 'Valid', [field]: value }
    expect((await createPosting(context(jsonRequest('postings', body)))).status).toBe(400)
    const ctx = { ...context(jsonRequest(`postings/${id}`, { [field]: value })), params: { id } }
    expect((await updatePosting(ctx)).status).toBe(400)
  }
  expect(db.sql.prepare('SELECT count(*) n FROM job_postings').get().n).toBe(1)
  expect(db.sql.prepare('SELECT title FROM job_postings WHERE id = ?').get(id).title).toBe('Original')
})

it.each([null, [], 'text', 42])('rejects invalid posting request bodies: %j', async (body) => {
  const id = await postingFixture()
  expect((await createPosting(context(jsonRequest('postings', body)))).status).toBe(400)
  expect((await updatePosting({ ...context(jsonRequest(`postings/${id}`, body)), params: { id } })).status).toBe(400)
})

it('keeps normal posting edits and optional-field clearing working', async () => {
  const id = await postingFixture()
  const patch = (body) => updatePosting({ ...context(jsonRequest(`postings/${id}`, body)), params: { id } })
  expect((await patch({ title: ' Revised ', department: 'Engineering' })).status).toBe(200)
  expect((await patch({ department: null })).status).toBe(200)
  expect((await patch({ title: null })).status).toBe(400)
  const posting = db.sql.prepare('SELECT title, department FROM job_postings WHERE id = ?').get(id)
  expect(posting.title).toBe('Revised')
  expect(posting.department).toBeNull()
})
