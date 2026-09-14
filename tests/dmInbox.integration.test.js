import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestGet } from '../server/api/dm/index.js'
let db
beforeEach(() => { db = sqliteApp(); seedUser(db, 'me'); seedUser(db, 'other'); seedUser(db, 'stranger') })
afterEach(() => db.close())

it('aggregates unread counts and joins the last message once, without correlated scans', async () => {
  for (const [from, to, body] of [['other', 'me', 'one'], ['me', 'other', 'reply'], ['other', 'stranger', 'private']]) {
    db.sql.prepare('INSERT INTO direct_messages (sender_id,recipient_id,body) VALUES (?,?,?)').run(from, to, body)
  }
  const prepare = vi.spyOn(db, 'prepare')
  const response = await onRequestGet({ env: { DB: db }, data: { user: { id: 'me' } } })
  expect(await response.json()).toMatchObject({ unreadTotal: 1, threads: [{ lastBody: 'reply', lastFromMe: true, unread: 1 }] })
  expect(prepare).toHaveBeenCalledTimes(1)
  const plan = db.sql.prepare(`EXPLAIN QUERY PLAN ${prepare.mock.calls[0][0]}`).all('me')
  expect(plan.some((row) => row.detail.includes('CORRELATED'))).toBe(false)
})

it('returns an empty inbox and rejects an unauthenticated caller', async () => {
  expect(await (await onRequestGet({ env: { DB: db }, data: { user: { id: 'me' } } })).json()).toEqual({ threads: [], unreadTotal: 0 })
  expect((await onRequestGet({ env: { DB: db }, data: {} })).status).toBe(401)
})
