import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { onRequestGet as getMessages, onRequestPost as postMessage } from '../server/api/rooms/[roomId]/messages.js'
vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Live database access prohibited') } }))
vi.mock('../server/_lib/messageAlert.js', () => ({ alertCandidate: vi.fn(), alertCompany: vi.fn() }))

let pg, db
const chatQueries = []
const chatBindings = []
const admin = { id: 'poll-admin', display_name: 'Synthetic Admin', role: 'company', is_admin: 1 }
const interviewer = { id: 'poll-interviewer', display_name: 'Synthetic Interviewer', role: 'company', is_admin: 0 }
function adapter(client) {
  return {
    async unsafe(query, values = []) {
      if (query.includes('FROM chat_messages m')) { chatQueries.push(query); chatBindings.push(values) }
      const result = await client.query(query, values)
      return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length })
    },
    begin(operation) { return client.transaction(transaction => operation(adapter(transaction))) },
  }
}
const context = (user = admin, session = null, body = null, roomId = 'poll-room') => ({
  env: { DB: db }, data: { user }, params: { roomId }, waitUntil() {},
  request: new Request(`https://test.invalid/api/rooms/${roomId}/messages${session ? `?interviewSessionId=${session}` : ''}`, {
    method: body ? 'POST' : 'GET', ...(body ? { body: JSON.stringify(body) } : {}),
  }),
})
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id TEXT PRIMARY KEY,name TEXT,public BOOLEAN,file_size_limit BIGINT);')
  await pg.exec(readFileSync('supabase/migrations/202609030001_cloudflare_to_supabase.sql', 'utf8'))
  db = new PostgresD1(adapter(pg))
  for (const user of [admin, interviewer]) {
    await pg.query("INSERT INTO users(id,email,password_hash,password_salt,role,display_name,is_admin) VALUES($1,$2,'unused','unused','company',$3,$4)", [user.id, `${user.id}@example.invalid`, user.display_name, user.is_admin])
  }
  await pg.exec(`INSERT INTO interview_rooms(id,company_user_id,title,status,invite_code) VALUES('poll-room','poll-admin','Synthetic room','open','POLL2345ABCD');
    INSERT INTO room_participants(room_id,user_id,role_in_room) VALUES('poll-room','poll-admin','company');
    INSERT INTO interview_sessions(id,room_id,provider_meeting_id,title,status) VALUES('poll-session','poll-room','synthetic-provider','Synthetic session','live');
    INSERT INTO interview_session_members(session_id,user_id,role,custom_participant_id) VALUES('poll-session','poll-interviewer','interviewer','synthetic-member');
    INSERT INTO chat_messages(room_id,sender_user_id,body,interview_session_id) VALUES('poll-room','poll-interviewer','Session-only message','poll-session');
    INSERT INTO interview_rooms(id,company_user_id,title,status,invite_code) VALUES('other-room','poll-admin','Other synthetic room','open','OTHER2345ABC');
    INSERT INTO interview_sessions(id,room_id,provider_meeting_id,title,status) VALUES('other-session','other-room','other-provider','Other session','live');
    INSERT INTO chat_messages(room_id,sender_user_id,body,interview_session_id) VALUES('other-room','poll-admin','Other room private message','other-session');`)
}, 30000)
beforeEach(() => {
  chatQueries.length = 0; chatBindings.length = 0
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No external traffic allowed') }))
})
afterEach(() => vi.unstubAllGlobals())
afterAll(async () => { await pg?.close() })

it('loads ordinary room polling after the actual POST commits without an unresolved nullable PostgreSQL parameter', async () => {
  const sent = await postMessage(context(admin, null, { body: 'Synthetic message saved before polling' }))
  expect(sent.status).toBe(201)
  expect((await pg.query("SELECT count(*)::integer n FROM chat_messages WHERE body='Synthetic message saved before polling'")).rows[0].n).toBe(1)
  const response = await getMessages(context())
  expect(response.status).toBe(200)
  expect((await response.json()).messages.map(message => message.body)).toEqual(['Session-only message', 'Synthetic message saved before polling'])
  expect(chatQueries.at(-1)).toContain('CAST($3 AS TEXT) IS NULL OR m.interview_session_id = $4')
  expect(fetch).not.toHaveBeenCalled()
})

it('loads only the authorized interview session when the optional filter is non-null', async () => {
  const response = await getMessages(context(interviewer, 'poll-session'))
  expect(response.status).toBe(200)
  expect((await response.json()).messages.map(message => message.body)).toEqual(['Session-only message'])
  expect(fetch).not.toHaveBeenCalled()
})

it('preserves administrator session denial and rejects other rooms or unregistered sessions', async () => {
  expect((await getMessages(context(admin, 'poll-session'))).status).toBe(403)
  expect((await getMessages(context(interviewer, null, null, 'other-room'))).status).toBe(403)
  expect((await getMessages(context(interviewer, 'other-session', null, 'other-room'))).status).toBe(403)
  expect((await getMessages(context(interviewer, 'poll-session', null, 'other-room'))).status).toBe(404)
  expect((await getMessages(context(interviewer))).status).toBe(403)
  expect(chatQueries).toEqual([])
  expect(fetch).not.toHaveBeenCalled()
})

it('accepts an exact PostgreSQL BIGINT cursor above Number.MAX_SAFE_INTEGER without truncation', async () => {
  const call = context()
  call.request = new Request('https://test.invalid/api/rooms/poll-room/messages?after=9007199254740993')
  const response = await getMessages(call)
  expect(response.status).toBe(200)
  expect((await response.json()).messages).toEqual([])
  expect(chatBindings.at(-1)[1]).toBe('9007199254740993')
})
