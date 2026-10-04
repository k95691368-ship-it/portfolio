// Isolated regressions for complete offer evidence with bounded history reads.
// No live database, mail provider, hire confirmation, or signature operation is used.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { sqliteApp } from './helpers/sqliteApp.js'
vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Live database access prohibited') } }))
vi.mock('../server/_lib/messageAlert.js', () => ({ alertCandidate: vi.fn(), alertCompany: vi.fn() }))
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { loadCompanyMessages } from '../server/_lib/rooms.js'
import { describeOfferStatus } from '../server/_lib/jobOffer.js'
import { offerStatusForApplication } from '../server/_lib/offerFromEmail.js'
import { onRequestGet as viewRoom } from '../server/api/rooms/[roomId]/view.js'
import { onRequestPatch as updateContract } from '../server/api/rooms/[roomId]/contract.js'
import { onRequestPost as closeRoom } from '../server/api/rooms/[roomId]/close.js'
import { onRequestPost as archiveRoom } from '../server/api/rooms/[roomId]/archive.js'
import { onRequestPost as postMessage } from '../server/api/rooms/[roomId]/messages.js'

beforeAll(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External traffic prohibited') })))
afterAll(() => {
  expect(fetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

const FIRST = '2026-09-01 09:00:00'
const LAST = '2026-09-30 09:00:00'
const OFFER = '최종 합격하셨습니다.'
const NEXT_OFFER = '10월 5일부터 출근해 주세요.'
const owner = { id: 'audit-owner', role: 'company', display_name: 'Synthetic employer' }
const candidate = { id: 'audit-candidate', role: 'candidate', display_name: 'Synthetic candidate' }
const interviewer = { id: 'audit-interviewer', role: 'company', display_name: 'Synthetic interviewer' }

function adapter(client) {
  return {
    async unsafe(query, values = []) {
      const result = await client.query(query, values)
      return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length })
    },
    begin(operation) { return client.transaction(transaction => operation(adapter(transaction))) },
  }
}

for (const engine of ['SQLite', 'production PostgresD1 + PGlite']) {
  describe(engine, () => {
    let db, pg, env, sequence = 0

    beforeAll(async () => {
      if (engine === 'SQLite') {
        db = sqliteApp()
      } else {
        pg = new PGlite()
        await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id TEXT PRIMARY KEY,name TEXT,public BOOLEAN,file_size_limit BIGINT);')
        await pg.exec(readFileSync('supabase/migrations/202609030001_cloudflare_to_supabase.sql', 'utf8'))
        db = new PostgresD1(adapter(pg))
      }
      env = { DB: db, EMAIL_ENABLED: '0' }
      for (const user of [owner, candidate, interviewer]) {
        await db.prepare("INSERT INTO users(id,email,password_hash,password_salt,role,display_name) VALUES(?,?,'unused','unused',?,?)")
          .bind(user.id, `${user.id}@example.invalid`, user.role, user.display_name).run()
      }
    }, 30000)

    afterAll(async () => { if (pg) await pg.close(); else db?.close() })

    async function fixture({ count = 501, offers = [501], confirmed = false, candidateOffer = false, sessionRole } = {}) {
      const id = `audit-room-${++sequence}`
      await db.prepare("INSERT INTO interview_rooms(id,company_user_id,title,status,invite_code) VALUES(?,?,'Synthetic interview','active',?)")
        .bind(id, owner.id, `AUDIT-CODE-${sequence}`).run()
      await db.batch([
        db.prepare("INSERT INTO room_participants(room_id,user_id,role_in_room) VALUES(?,?,'company')").bind(id, owner.id),
        db.prepare("INSERT INTO room_participants(room_id,user_id,role_in_room) VALUES(?,?,'candidate')").bind(id, candidate.id),
        db.prepare('INSERT INTO contract_terms(room_id,wage_base_amount,hire_confirmed,hire_confirmed_at,hire_confirmation_excerpt) VALUES(?,3000000,?,?,?)')
          .bind(id, confirmed ? 1 : 0, confirmed ? FIRST : null, confirmed ? 'Synthetic explicit confirmation' : null),
      ])
      let sessionId = null
      if (sessionRole) {
        sessionId = `${id}-session`
        await db.prepare("INSERT INTO interview_sessions(id,room_id,provider_meeting_id,title,status) VALUES(?,?,?,'Synthetic ended interview','ended')")
          .bind(sessionId, id, `${id}-provider`).run()
        await db.prepare('INSERT INTO interview_session_members(session_id,user_id,role,custom_participant_id) VALUES(?,?,?,?)')
          .bind(sessionId, interviewer.id, sessionRole, `${id}-member`).run()
      }
      const statements = []
      for (let ordinal = 1; ordinal <= count; ordinal++) {
        const body = offers.includes(ordinal) ? (ordinal === offers[0] ? OFFER : NEXT_OFFER) : `업무 내용을 확인 중입니다. ${ordinal}`
        statements.push(db.prepare('INSERT INTO chat_messages(room_id,sender_user_id,body,created_at,interview_session_id) VALUES(?,?,?,?,?)')
          .bind(id, sessionRole ? interviewer.id : owner.id, body, ordinal === 1 ? FIRST : LAST, sessionId))
      }
      if (candidateOffer) {
        statements.push(db.prepare('INSERT INTO chat_messages(room_id,sender_user_id,body,created_at) VALUES(?,?,?,?)')
          .bind(id, candidate.id, OFFER, LAST))
      }
      if (statements.length) await db.batch(statements)
      return id
    }

    function context(id, suffix, body, method = 'POST') {
      return {
        env, data: { user: owner }, params: { roomId: id }, waitUntil() {},
        request: new Request(`https://test.invalid/api/rooms/${id}/${suffix}`, {
          method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      }
    }

    async function status(id) {
      const terms = await db.prepare('SELECT * FROM contract_terms WHERE room_id=?').bind(id).first()
      const messages = await loadCompanyMessages(env, id)
      return { messages, offer: describeOfferStatus({ terms, messages }) }
    }

    // A full-history counterfactual changes retrieval only; it uses the existing predicate and parser.
    async function fullHistory(id) {
      const { results } = await db.prepare(`SELECT m.body,m.created_at,'company' AS role_in_room
        FROM chat_messages m LEFT JOIN room_participants rp ON rp.room_id=m.room_id AND rp.user_id=m.sender_user_id
        WHERE m.room_id=? AND (rp.role_in_room='company' OR EXISTS(
          SELECT 1 FROM interview_session_members ism JOIN interview_sessions s ON s.id=ism.session_id
          WHERE s.room_id=m.room_id AND ism.user_id=m.sender_user_id AND ism.role IN ('host','interviewer')))
        ORDER BY m.id ASC`).bind(id).all()
      return results
    }

    async function observedHistory(id, onPage) {
      const pages = []
      const observedEnv = { ...env, DB: {
        prepare(source) {
          const wrap = (statement, values = []) => ({
            bind(...args) { return wrap(statement.bind(...args), args) },
            async all() {
              const result = await statement.all()
              pages.push({ source, values, count: result.results.length,
                upperId: result.results[0]?.offer_upper_id,
                firstId: result.results[0]?.offer_message_id,
                lastId: result.results.at(-1)?.offer_message_id })
              await onPage?.(pages.length)
              return result
            },
          })
          return wrap(db.prepare(source))
        },
      } }
      return { messages: await loadCompanyMessages(observedEnv, id), pages }
    }

    async function setBody(id, ordinal, body) {
      await db.prepare(`UPDATE chat_messages SET body=? WHERE id IN
        (SELECT id FROM chat_messages WHERE room_id=? ORDER BY id ASC LIMIT 1 OFFSET ?)`)
        .bind(body, id, ordinal - 1).run()
    }

    it('control: the 500th employer message is detected by the existing policy', async () => {
      const id = await fixture({ count: 500, offers: [500] })
      const { messages, offer } = await status(id)
      expect(messages).toHaveLength(1)
      expect(offer).toMatchObject({ established: true, basis: 'phrase', excerpt: OFFER, at: LAST })
      expect((await offerStatusForApplication(env, { room_id: id })).established).toBe(true)
    })

    it('detects the first explicit offer at employer message 501 with the existing policy', async () => {
      const id = await fixture()
      const { messages, offer } = await status(id)
      expect(messages).toHaveLength(1)
      expect(messages[0].body).toBe(OFFER)
      expect(offer.established).toBe(true)
      const all = await fullHistory(id)
      expect(all).toHaveLength(501)
      expect(describeOfferStatus({ messages: all })).toMatchObject({ established: true, basis: 'phrase', excerpt: OFFER })
      expect((await offerStatusForApplication(env, { room_id: id })).established).toBe(true)
    })

    it('the actual room view displays the late explicit offer and reports established=true', async () => {
      const id = await fixture()
      const response = await viewRoom(context(id, 'view', undefined, 'GET'))
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.messages).toHaveLength(200)
      expect(body.messages.at(-1).body).toBe(OFFER)
      expect(body.offer.established).toBe(true)
    })

    it('actual message POST and the following view both detect the offer at message 501', async () => {
      const id = await fixture({ count: 500, offers: [] })
      const response = await postMessage(context(id, 'messages', { body: OFFER }))
      expect(response.status).toBe(201)
      expect((await response.json()).offerSignal.strong[0].text).toBe(OFFER)
      expect((await db.prepare('SELECT COUNT(*) n FROM chat_messages WHERE room_id=?').bind(id).first()).n).toBe(501)
      expect((await db.prepare('SELECT hire_confirmed FROM contract_terms WHERE room_id=?').bind(id).first()).hire_confirmed).toBe(0)
      const view = await viewRoom(context(id, 'view', undefined, 'GET'))
      expect(view.status).toBe(200)
      const body = await view.json()
      expect(body.messages.at(-1).body).toBe(OFFER)
      expect(body.offer.established).toBe(true)
    })

    it('unacknowledged close requires acknowledgement at both employer messages 500 and 501', async () => {
      const late = await fixture()
      const early = await fixture({ count: 500, offers: [500] })
      const close = await closeRoom(context(late, 'close', { reason: 'terms_not_agreed' }))
      expect(close.status).toBe(409)
      expect(await close.json()).toMatchObject({ requiresAcknowledgement: true, offer: { established: true } })
      expect(await db.prepare('SELECT status FROM interview_rooms WHERE id=?').bind(late).first()).toMatchObject({ status: 'active' })
      expect(await db.prepare('SELECT action FROM room_lifecycle_log WHERE room_id=?').bind(late).first()).toBeNull()
      const blocked = await closeRoom(context(early, 'close', { reason: 'terms_not_agreed' }))
      expect(blocked.status).toBe(409)
      expect(await blocked.json()).toMatchObject({ requiresAcknowledgement: true, offer: { established: true } })
      expect(await db.prepare('SELECT status FROM interview_rooms WHERE id=?').bind(early).first()).toMatchObject({ status: 'active' })
    })

    it('unacknowledged archive requires acknowledgement at both employer messages 500 and 501', async () => {
      const late = await fixture()
      const early = await fixture({ count: 500, offers: [500] })
      const lateResponse = await archiveRoom(context(late, 'archive', {}))
      expect(lateResponse.status).toBe(409)
      expect(await lateResponse.json()).toMatchObject({ requiresAcknowledgement: true, offer: { established: true } })
      expect((await db.prepare('SELECT archived_at FROM interview_rooms WHERE id=?').bind(late).first()).archived_at).toBeNull()
      const blocked = await archiveRoom(context(early, 'archive', {}))
      expect(blocked.status).toBe(409)
      expect(await blocked.json()).toMatchObject({ requiresAcknowledgement: true, offer: { established: true } })
      expect((await db.prepare('SELECT archived_at FROM interview_rooms WHERE id=?').bind(early).first()).archived_at).toBeNull()
    })

    it('actual wage reduction provides the same offerWarning at employer messages 500 and 501', async () => {
      const late = await fixture()
      const early = await fixture({ count: 500, offers: [500] })
      const lateResponse = await updateContract(context(late, 'contract', { wageBaseAmount: 2500000 }, 'PATCH'))
      const earlyResponse = await updateContract(context(early, 'contract', { wageBaseAmount: 2500000 }, 'PATCH'))
      expect(lateResponse.status).toBe(200)
      expect(earlyResponse.status).toBe(200)
      const lateBody = await lateResponse.json()
      const earlyBody = await earlyResponse.json()
      expect(lateBody.offerWarning).toEqual(earlyBody.offerWarning)
      expect(earlyBody.offerWarning.changes).toEqual([
        { field: 'wageBaseAmount', label: '임금', detail: '3,000,000원에서 2,500,000원으로 500,000원 낮아집니다.' },
      ])
    })

    it('control: the earliest explicit offer and its timestamp survive more than 500 later employer messages', async () => {
      const id = await fixture({ count: 601, offers: [1, 601] })
      const { offer } = await status(id)
      expect(offer).toMatchObject({ established: true, basis: 'phrase', excerpt: OFFER, at: FIRST })
      const all = await fullHistory(id)
      expect(all).toHaveLength(601)
      expect(describeOfferStatus({ messages: all })).toMatchObject({ excerpt: OFFER, at: FIRST })
    })

    it('control: candidate explicit phrases and candidate session-member phrases remain excluded', async () => {
      const id = await fixture({ count: 501, offers: [], candidateOffer: true })
      const sessionId = await fixture({ count: 1, offers: [1], sessionRole: 'candidate' })
      expect((await status(id)).offer.established).toBe(false)
      expect(await fullHistory(id)).toHaveLength(501)
      expect(describeOfferStatus({ messages: await fullHistory(id) }).established).toBe(false)
      expect(await loadCompanyMessages(env, sessionId)).toEqual([])
      expect(await fullHistory(sessionId)).toEqual([])
    })

    it('an employer-side session-only interviewer remains eligible beyond 500 messages', async () => {
      const id = await fixture({ sessionRole: 'interviewer' })
      expect((await status(id)).offer.established).toBe(true)
      expect(await loadCompanyMessages(env, id)).toHaveLength(1)
      const all = await fullHistory(id)
      expect(all).toHaveLength(501)
      expect(describeOfferStatus({ messages: all }).established).toBe(true)
    })

    it('counterexample: explicit hire_confirmed=1 retains the existing guard and warning despite a late chat offer', async () => {
      const id = await fixture({ confirmed: true })
      expect((await status(id)).offer).toMatchObject({ established: true, basis: 'ai', excerpt: 'Synthetic explicit confirmation', at: FIRST })
      expect((await offerStatusForApplication(env, { room_id: id })).established).toBe(true)
      expect((await closeRoom(context(id, 'close', {}))).status).toBe(409)
      expect((await archiveRoom(context(id, 'archive', {}))).status).toBe(409)
      const reduction = await updateContract(context(id, 'contract', { wageBaseAmount: 2500000 }, 'PATCH'))
      expect(reduction.status).toBe(200)
      expect((await reduction.json()).offerWarning.changes[0].field).toBe('wageBaseAmount')
    })

    it('keeps ordinary short and empty room histories to one bounded query', async () => {
      const short = await observedHistory(await fixture({ count: 20, offers: [] }))
      const empty = await observedHistory(await fixture({ count: 0, offers: [] }))
      expect(short.messages).toEqual([])
      expect(short.pages.map(page => page.count)).toEqual([20])
      expect(empty.messages).toEqual([])
      expect(empty.pages.map(page => page.count)).toEqual([0])
      expect(short.pages[0].source).toContain('WITH offer_scan_snapshot AS')
      expect(short.pages[0].values.at(-1)).toBe(500)
    })

    it.each(['none', 'weak-only', 'strong-only'])('scans all high-water pages for %s history while retaining only evidence', async kind => {
      const id = await fixture({ count: 1001, offers: kind === 'strong-only' ? [1, 501, 1001] : [] })
      if (kind === 'weak-only') {
        await setBody(id, 501, '언제부터 출근 가능하신가요?')
        await setBody(id, 1001, '계약서 준비하겠습니다.')
      }
      const { messages, pages } = await observedHistory(id)
      expect(pages.map(page => page.count)).toEqual([500, 500, 1])
      expect(pages.every(page => page.values.at(-1) === 500)).toBe(true)
      expect(pages[1].values[2]).toBe(pages[0].lastId)
      expect(pages[2].values[2]).toBe(pages[1].lastId)
      expect(describeOfferStatus({ messages })).toEqual(describeOfferStatus({ messages: await fullHistory(id) }))
      expect(messages).toHaveLength(kind === 'none' ? 0 : kind === 'weak-only' ? 2 : 3)
    })

    it('stops further queries once the first five strong and five weak messages are retained', async () => {
      const id = await fixture({ count: 1501, offers: [] })
      for (let ordinal = 1; ordinal <= 5; ordinal++) await setBody(id, ordinal, OFFER)
      for (let ordinal = 6; ordinal <= 10; ordinal++) await setBody(id, ordinal, '언제부터 출근 가능하신가요?')
      await setBody(id, 1501, NEXT_OFFER)
      const { messages, pages } = await observedHistory(id)
      expect(pages.map(page => page.count)).toEqual([500])
      expect(messages).toHaveLength(10)
      const offer = describeOfferStatus({ messages })
      expect(offer.signals.strong).toHaveLength(5)
      expect(offer.signals.weak).toHaveLength(5)
      expect(offer).toEqual(describeOfferStatus({ messages: await fullHistory(id) }))
    })

    it('matches full-history first-five signals, earliest timestamps and excerpts when categories overlap across pages', async () => {
      const id = await fixture({ count: 1501, offers: [] })
      for (const [ordinal, body] of [
        [1, '최종 합격하셨습니다. 계약서 준비하겠습니다.'],
        [2, '합격이 아닙니다.'], [3, '합격 여부는 다음 주에 알려드립니다.'],
        [20, '언제부터 출근 가능하신가요?'], [500, OFFER],
        [501, '서류 준비하겠습니다.'], [502, '최종 합격입니다. 자리 준비하겠습니다.'],
        [750, NEXT_OFFER], [1000, '계약서 준비하겠습니다.'],
        [1001, '입사일 10월 5일로 하시죠. 계약서 준비하겠습니다.'],
        [1250, NEXT_OFFER], [1501, '서류 준비하겠습니다.'],
      ]) await setBody(id, ordinal, body)
      const { messages, pages } = await observedHistory(id)
      expect(messages.length).toBeLessThanOrEqual(10)
      expect(pages.map(page => page.count)).toEqual([500, 500, 500])
      const offer = describeOfferStatus({ messages })
      expect(offer).toEqual(describeOfferStatus({ messages: await fullHistory(id) }))
      expect(offer).toMatchObject({ at: FIRST, excerpt: OFFER })
      expect(offer.signals.strong).toHaveLength(5)
      expect(offer.signals.weak).toHaveLength(5)
    })

    it('uses the whole target room high-water mark while excluding candidates and other rooms from evidence', async () => {
      const id = await fixture({ count: 501, offers: [], candidateOffer: true })
      const targetMax = await db.prepare('SELECT CAST(MAX(id) AS TEXT) AS upper_id FROM chat_messages WHERE room_id=?').bind(id).first()
      await fixture({ count: 1, offers: [1] })
      const { messages, pages } = await observedHistory(id)
      expect(messages).toEqual([])
      expect(pages.map(page => page.count)).toEqual([500, 1])
      expect(pages.every(page => page.upperId === targetMax.upper_id)).toBe(true)
      expect(describeOfferStatus({ messages }).established).toBe(false)
    })

    it('finishes at the starting high-water mark despite a synthetic message append between page reads', async () => {
      const id = await fixture({ count: 501, offers: [] })
      let appended = false
      const { messages, pages } = await observedHistory(id, async page => {
        if (page !== 1) return
        await db.prepare('INSERT INTO chat_messages(room_id,sender_user_id,body) VALUES(?,?,?)').bind(id, owner.id, OFFER).run()
        appended = true
      })
      expect(appended).toBe(true)
      expect(pages.map(page => page.count)).toEqual([500, 1])
      expect(pages[1].upperId).toBe(pages[0].upperId)
      expect(messages).toEqual([])
      expect((await status(id)).offer.established).toBe(true)
    })

    it('preserves exact keyset cursors and the upper bound above Number.MAX_SAFE_INTEGER', async () => {
      const id = await fixture({ count: 0, offers: [] })
      const firstId = 9007199254740993n
      for (let ordinal = 0; ordinal <= 500; ordinal++) {
        const values = [String(firstId + BigInt(ordinal)), id, owner.id, ordinal === 500 ? OFFER : '업무 내용을 확인 중입니다.']
        const source = 'INSERT INTO chat_messages(id,room_id,sender_user_id,body) VALUES(?,?,?,?)'
        if (pg) await db.prepare(source).bind(...values).run()
        else {
          const statement = db.sql.prepare(source)
          statement.setReadBigInts(true)
          statement.run(...values)
        }
      }
      const { messages, pages } = await observedHistory(id)
      expect(pages.map(page => page.count)).toEqual([500, 1])
      expect(pages[0].firstId).toBe(String(firstId))
      expect(pages[0].upperId).toBe(String(firstId + 500n))
      expect(pages[1].values[0]).toBe(String(firstId + 500n))
      expect(pages[1].values[2]).toBe(String(firstId + 499n))
      expect(pages[1].lastId).toBe(String(firstId + 500n))
      expect(describeOfferStatus({ messages })).toEqual(describeOfferStatus({ messages: await fullHistory(id) }))
      expect(describeOfferStatus({ messages }).established).toBe(true)
    })
  })
}
