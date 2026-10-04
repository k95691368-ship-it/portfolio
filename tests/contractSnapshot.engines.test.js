import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalDatabase } from '../scripts/local/database.mjs'
import { sqliteApp } from './helpers/sqliteApp.js'

vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Live database access prohibited') } }))
vi.mock('../server/_lib/claude.js', () => ({ analyzeConversation: vi.fn() }))
vi.mock('../server/_lib/notify.js', () => ({ notifyUser: vi.fn(async () => {}) }))
vi.mock('../server/_lib/contractArchive.js', () => ({ archiveContractQuietly: vi.fn(async () => {}) }))
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { analyzeConversation } from '../server/_lib/claude.js'
import { onRequestPost as sign } from '../server/api/rooms/[roomId]/sign.js'
import { onRequestPost as analyze } from '../server/api/rooms/[roomId]/analyze.js'

let postgres
beforeAll(async () => { postgres = await createLocalDatabase() }, 30_000)
afterAll(async () => { await postgres?.close() })

describe.each(['PostgreSQL', 'SQLite'])('%s contract snapshot guards', engine => {
  let db, sqlite, beforeStatement
  const user = { id: 'company', role: 'company', email: 'company@example.invalid', auth_method: 'password' }
  const body = { imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }
  const initialVersion = '2026-10-04T10:00:00.000Z'
  const nextVersion = '2026-10-04T10:00:01.000Z'
  function adapter(client) {
    return {
      async unsafe(query, values = []) {
        await beforeStatement?.(query)
        const result = await client.query(query, values)
        return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length })
      },
      begin: operation => client.transaction(transaction => operation(adapter(transaction))),
    }
  }
  const context = payload => ({ env: { DB: db }, data: { user }, params: { roomId: 'room' },
    request: new Request('https://test.invalid/sign', { method: 'POST', headers: { 'CF-Connecting-IP': '127.0.0.1' }, body: JSON.stringify(payload) }) })
  const execute = async source => engine === 'PostgreSQL' ? postgres.client.exec(source) : sqlite.sql.exec(source)
  const stored = () => db.prepare('SELECT * FROM contract_terms WHERE room_id = ?').bind('room').first()
  const signatureCount = async () => Number((await db.prepare('SELECT count(*) AS n FROM signatures').first()).n)

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('External traffic prohibited') })
    beforeStatement = null
    if (engine === 'PostgreSQL') {
      await postgres.client.exec('TRUNCATE users CASCADE')
      db = new PostgresD1(adapter(postgres.client))
    } else {
      sqlite = sqliteApp()
      db = sqlite
    }
    await execute(`INSERT INTO users (id,email,password_hash,password_salt,role,display_name) VALUES
      ('company','company@example.invalid','unused','unused','company','Synthetic company'),
      ('candidate','candidate@example.invalid','unused','unused','candidate','Synthetic candidate');
      INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code)
        VALUES ('room','company','Non-binding fixture','contract_pending','TESTSNAPSHOT');
      INSERT INTO room_participants (room_id,user_id,role_in_room)
        VALUES ('room','company','company'),('room','candidate','candidate');
      INSERT INTO contract_terms (room_id,employer_name,employee_name,work_location,job_description,
        contract_start_date,contract_end_date,work_hours_start,work_hours_end,work_days,rest_days,
        wage_base_amount,wage_pay_method,wage_pay_date,annual_leave,break_time,employee_count,hire_confirmed,updated_at)
        VALUES ('room','Synthetic employer','Synthetic employee','서울 본사','개발','2026-09-01','2027-08-31',
        '09:00','18:00','주 5일 (월~금)','토요일, 일요일',3000000,'계좌이체','매월 25일','근로기준법에 따름',
        '12:00~13:00',10,1,'${initialVersion}');
      INSERT INTO chat_messages (room_id,sender_user_id,body) VALUES ('room','company','Synthetic conversation');`)
  })
  afterEach(() => { sqlite?.close(); sqlite = null; vi.restoreAllMocks() })

  it.each([[null, null, true], [initialVersion, initialVersion, true], [initialVersion, nextVersion, false],
    [null, initialVersion, false], [initialVersion, null, false]])('supports NULL-safe comparison %#', async (left, right, same) => {
    const row = await db.prepare('SELECT ? IS NOT DISTINCT FROM ? AS same').bind(left, right).first()
    expect(Boolean(row.same)).toBe(same)
  })

  it('stores a normal signature with the actual handler and unchanged snapshot', async () => {
    const response = await sign(context(body))
    expect(response.status).toBe(200)
    expect(await signatureCount()).toBe(1)
    const record = await db.prepare('SELECT document_sha256,verified_email FROM signatures').first()
    expect(record.document_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(record.verified_email).toBe(user.email)
  })

  it('rejects a changed snapshot at INSERT without storing a stale signature', async () => {
    if (engine === 'PostgreSQL') {
      beforeStatement = async query => {
        if (!query.startsWith('INSERT INTO signatures')) return
        beforeStatement = null
        await execute(`UPDATE contract_terms SET updated_at='${nextVersion}',wage_base_amount=4000000 WHERE room_id='room'`)
      }
    } else {
      const prepare = db.prepare.bind(db)
      db.prepare = source => {
        const statement = prepare(source)
        if (source.startsWith('INSERT INTO signatures')) {
          const run = statement.run
          statement.run = async () => {
            await execute(`UPDATE contract_terms SET updated_at='${nextVersion}',wage_base_amount=4000000 WHERE room_id='room'`)
            return run()
          }
        }
        return statement
      }
    }
    const response = await sign(context(body))
    expect(response.status).toBe(409)
    expect(await signatureCount()).toBe(0)
    expect(Number((await stored()).wage_base_amount)).toBe(4000000)
  })

  it('continues rejecting a stored document whose wage conflicts with the conditions', async () => {
    const articles = [{ heading: '제6조 (임금)', body: '기본급은 2,500,000원이다.' }]
    await db.prepare('UPDATE contract_terms SET ai_document_json = ? WHERE room_id = ?').bind(JSON.stringify(articles), 'room').run()
    const response = await sign(context(body))
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('본문')
    expect(await signatureCount()).toBe(0)
  })

  it('keeps previous-signature history on a normal re-sign', async () => {
    expect((await sign(context(body))).status).toBe(200)
    expect((await sign(context(body))).status).toBe(200)
    expect(await signatureCount()).toBe(1)
    const previous = await db.prepare('SELECT reason,document_sha256 FROM signature_revocations').first()
    expect(previous.reason).toBe('본인이 다시 서명함')
    expect(previous.document_sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('writes analyzed conditions when the original snapshot still matches', async () => {
    analyzeConversation.mockResolvedValue({ terms: { work_location: '합성 새 근무지' }, hire_confirmed: false, warnings: [] })
    const response = await analyze(context({}))
    expect(response.status).toBe(200)
    expect((await stored()).work_location).toBe('합성 새 근무지')
    expect(Number((await stored()).hire_confirmed)).toBe(1)
  })

  it('does not overwrite newer conditions when analysis returns late', async () => {
    analyzeConversation.mockImplementation(async () => {
      await execute(`UPDATE contract_terms SET updated_at='${nextVersion}',wage_base_amount=4000000 WHERE room_id='room'`)
      return { terms: { work_location: '합성 오래된 결과' }, hire_confirmed: false, warnings: [] }
    })
    const response = await analyze(context({}))
    expect(response.status).toBe(409)
    const record = await stored()
    expect(record.work_location).toBe('서울 본사')
    expect(Number(record.wage_base_amount)).toBe(4000000)
    expect(Number(record.hire_confirmed)).toBe(1)
  })
})
