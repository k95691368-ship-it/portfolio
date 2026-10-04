import { afterEach, beforeEach, expect, it } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestPost as createRequest } from '../server/api/rooms/[roomId]/change-requests/index.js'
import { onRequestPost as respondRequest } from '../server/api/rooms/[roomId]/change-requests/[reqId].js'

let db, company, candidate
beforeEach(() => {
  db = sqliteApp()
  company = seedUser(db, 'change-company', 'company')
  candidate = seedUser(db, 'change-candidate')
  db.sql.exec(`INSERT INTO interview_rooms (id, company_user_id, title, status, invite_code)
    VALUES ('room', 'change-company', 'Interview', 'active', 'CHANGEINPUT12');
    INSERT INTO room_participants (room_id, user_id, role_in_room)
    VALUES ('room', 'change-company', 'company'), ('room', 'change-candidate', 'candidate');
    INSERT INTO contract_terms (room_id, work_location) VALUES ('room', 'Original location');`)
})
afterEach(() => db.close())

const context = (body, user = candidate, reqId) => ({
  env: { DB: db }, data: { user }, params: { roomId: 'room', reqId },
  request: new Request('https://test.invalid/api/rooms/room/change-requests', {
    method: 'POST', body: JSON.stringify(body),
  }),
})
const valid = { field: 'workLocation', requestedValue: 'New location', reason: 'Office moved' }
const pending = () => db.sql.prepare('SELECT * FROM contract_change_requests').get()
const location = () => db.sql.prepare("SELECT work_location FROM contract_terms WHERE room_id = 'room'").get().work_location

it.each(['constructor', '__proto__', 'toString', ['workLocation']].map(field => ({ field })))('rejects non-allowlisted field $field before SQL or a change request is written', async ({ field }) => {
  const response = await createRequest(context({ ...valid, field }))
  expect(response.status).toBe(400)
  expect(pending()).toBeUndefined()
  expect(location()).toBe('Original location')
  expect(db.sql.prepare('SELECT COUNT(*) AS n FROM notifications').get().n).toBe(0)
})

it.each([
  ['requestedValue', { toString: null }], ['requestedValue', {}], ['requestedValue', ['office']],
  ['requestedValue', true], ['requestedValue', 123],
  ['reason', { toString: null }], ['reason', {}], ['reason', ['reason']], ['reason', true],
])('rejects malformed %s values without creating a request: %j', async (field, value) => {
  const response = await createRequest(context({ ...valid, [field]: value }))
  expect(response.status).toBe(400)
  expect(pending()).toBeUndefined()
  expect(location()).toBe('Original location')
})

it.each([{ toString: null }, {}, ['note'], true, 123].map(note => ({ note })))('rejects malformed response notes without accepting the request: $note', async ({ note }) => {
  expect((await createRequest(context(valid))).status).toBe(201)
  const row = pending()
  const response = await respondRequest(context({ action: 'accept', note }, company, row.id))
  expect(response.status).toBe(400)
  expect(pending().status).toBe('pending')
  expect(location()).toBe('Original location')
  expect(db.sql.prepare('SELECT COUNT(*) AS n FROM contract_edit_history').get().n).toBe(0)
})

it.each(['constructor', '__proto__', 'toString'])('does not interpolate a legacy invalid field %s when accepting', async (field) => {
  expect((await createRequest(context(valid))).status).toBe(201)
  const row = pending()
  db.sql.prepare('UPDATE contract_change_requests SET field = ? WHERE id = ?').run(field, row.id)
  const response = await respondRequest(context({ action: 'accept' }, company, row.id))
  expect(response.status).toBe(400)
  expect(pending().status).toBe('pending')
  expect(location()).toBe('Original location')
})

it.each([undefined, null, '  Reason  '])('keeps normal creation and acceptance working with optional text: %j', async (reason) => {
  expect((await createRequest(context({ ...valid, requestedValue: '  New location  ', reason }))).status).toBe(201)
  const row = pending()
  expect(row.requested_value).toBe('New location')
  expect(row.reason).toBe(reason == null ? null : 'Reason')
  const response = await respondRequest(context({ action: 'accept', note: reason }, company, row.id))
  expect(response.status).toBe(200)
  expect(pending().status).toBe('accepted')
  expect(pending().response_note).toBe(reason == null ? null : 'Reason')
  expect(location()).toBe('New location')
})
