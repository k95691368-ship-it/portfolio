import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { LocalPostgresD1 } from '../scripts/local/database.mjs'
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { onRequestGet as getRoomView } from '../server/api/rooms/[roomId]/view.js'
import { onRequestGet as getMessages, onRequestPost as postMessage } from '../server/api/rooms/[roomId]/messages.js'
vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Live database access prohibited') } }))
vi.mock('../server/_lib/messageAlert.js', () => ({ alertCandidate: vi.fn(), alertCompany: vi.fn() }))

let pg, databases
const user = { id: 'bigint-owner', display_name: 'Synthetic Owner', role: 'company' }
const firstLarge = '9007199254740993', secondLarge = '9007199254740994', nextLarge = '9007199254740995'
function adapter(client) {
  return {
    async unsafe(query, values = []) {
      const result = await client.query(query, values)
      return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length })
    },
    begin(operation) { return client.transaction(transaction => operation(adapter(transaction))) },
  }
}
function context(db, suffix = 'view', body) {
  return {
    env: { DB: db }, data: { user }, params: { roomId: 'bigint-room' }, waitUntil() {},
    request: new Request(`https://test.invalid/api/rooms/bigint-room/${suffix}`, body === undefined ? {} : {
      method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
    }),
  }
}
function expectPrivate(response, status = 200) {
  expect(response.status).toBe(status)
  expect(response.headers.get('Content-Type')).toBe('application/json')
  expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate, private')
  expect(response.headers.get('Vary')).toBe('Cookie, Authorization, X-Room-Authorization, Origin')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
}

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id TEXT PRIMARY KEY,name TEXT,public BOOLEAN,file_size_limit BIGINT);')
  await pg.exec(readFileSync('supabase/migrations/202609030001_cloudflare_to_supabase.sql', 'utf8'))
  await pg.exec(`INSERT INTO users(id,email,password_hash,password_salt,role,display_name) VALUES('bigint-owner','synthetic@example.invalid','unused','unused','company','Synthetic Owner');
    INSERT INTO interview_rooms(id,company_user_id,title,status,invite_code) VALUES('bigint-room','bigint-owner','Synthetic BIGINT room','open','BIGINT2345AB');
    INSERT INTO room_participants(room_id,user_id,role_in_room) VALUES('bigint-room','bigint-owner','company');`)
  databases = { local: new LocalPostgresD1(pg), supabaseAdapter: new PostgresD1(adapter(pg)) }
}, 30000)
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No external traffic allowed') }))
  await pg.exec('TRUNCATE chat_messages RESTART IDENTITY CASCADE')
  for (const [id, body] of [['9', 'Safe numeric message'], [firstLarge, 'First exact large message'], [secondLarge, 'Second exact large message']]) {
    await pg.query("INSERT INTO chat_messages(id,room_id,sender_user_id,body) VALUES($1,'bigint-room','bigint-owner',$2)", [id, body])
  }
})
afterEach(() => vi.unstubAllGlobals())
afterAll(async () => { await pg?.close() })

describe.each(['local', 'supabaseAdapter'])('%s real database wrapper and HTTP response', kind => {
  it('serializes a real room-view snapshot with unsafe BIGINT IDs losslessly while keeping normal IDs numeric', async () => {
    const raw = await databases[kind].prepare('SELECT id FROM chat_messages WHERE id = ?').bind(firstLarge).first()
    expect(typeof raw.id).toBe('bigint')
    expect(raw.id.toString()).toBe(firstLarge)
    const response = await getRoomView(context(databases[kind]))
    expectPrivate(response)
    const data = await response.json()
    expect(data.messages.map(message => message.id)).toEqual([9, firstLarge, secondLarge])
    expect(data.messages[1].body).toBe('First exact large message')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the exact room-view cursor to fetch the next unsafe BIGINT message once', async () => {
    const initial = await (await getRoomView(context(databases[kind]))).json()
    const cursor = initial.messages.at(-1).id
    await pg.query("INSERT INTO chat_messages(id,room_id,sender_user_id,body) VALUES($1,'bigint-room','bigint-owner','Next exact message')", [nextLarge])
    const response = await getMessages(context(databases[kind], `messages?after=${cursor}`))
    expectPrivate(response)
    const poll = await response.json()
    expect(poll.messages.map(message => message.id)).toEqual([nextLarge])
    const caughtUp = await getMessages(context(databases[kind], `messages?after=${poll.messages[0].id}`))
    expectPrivate(caughtUp)
    expect((await caughtUp.json()).messages).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns a committed high-ID POST as HTTP 201 and preserves that exact ID in the next poll', async () => {
    await pg.query("SELECT setval(pg_get_serial_sequence('chat_messages','id'),$1)", [secondLarge])
    const response = await postMessage(context(databases[kind], 'messages', { body: 'Acknowledged high-ID message' }))
    expectPrivate(response, 201)
    const posted = await response.json()
    expect(posted.id).toBe(nextLarge)
    expect(posted.body).toBe('Acknowledged high-ID message')
    expect((await pg.query('SELECT count(*)::integer AS count FROM chat_messages WHERE id = $1', [nextLarge])).rows[0].count).toBe(1)
    const poll = await getMessages(context(databases[kind], `messages?after=${secondLarge}`))
    expect((await poll.json()).messages.map(message => message.id)).toEqual([posted.id])
    expect(fetch).not.toHaveBeenCalled()
  })
})
