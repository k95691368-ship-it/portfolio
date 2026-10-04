import { afterEach, beforeEach, expect, it } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestGet as getApplication } from '../server/api/applications/[id]/index.js'
import { onRequestGet as getArchivedContracts } from '../server/api/admin/contracts/index.js'

// 권한 확인 뒤의 서로 기대지 않는 조회는 함께 보낸다. 질의마다 같은 지연을 주고
// 차례로 쌓이는 단계(DB 대기)를 센다. 권한 확인보다 먼저 읽는 것은 없다.
let db, users, inFlight, stages
beforeEach(() => {
  db = sqliteApp()
  users = { owner: seedUser(db, 'owner', 'company', { recruiter: 1 }), other: seedUser(db, 'other', 'company', { recruiter: 1 }), admin: seedUser(db, 'admin', 'company', { admin: 1 }) }
  seedUser(db, 'candidate')
  db.sql.exec(`INSERT INTO job_postings (id, created_by_user_id, title, description) VALUES ('posting', 'owner', '공고', '상세');
    INSERT INTO interview_rooms (id, company_user_id, title, status, invite_code) VALUES ('room', 'owner', '면접방', 'active', 'ABCD2345EFGH');`)
  db.sql.prepare(`INSERT INTO applications (id, posting_id, applicant_name, applicant_email, applicant_phone, created_user_id, cover_letter, consent_required, room_id)
    VALUES ('application', 'posting', '지원자', 'candidate@example.invalid', '010-0000-0000', 'candidate', '본문', 1, 'room')`).run()
  inFlight = 0
  stages = 0
  const prepare = db.prepare.bind(db)
  db.prepare = (source) => {
    const statement = prepare(source)
    const wrap = (target) => {
      for (const method of ['first', 'all', 'run']) {
        const original = target[method].bind(target)
        target[method] = async (...args) => {
          if (inFlight++ === 0) stages++
          try {
            await new Promise((resolve) => setTimeout(resolve, 10))
            return await original(...args)
          } finally { inFlight-- }
        }
      }
      return target
    }
    const bind = statement.bind.bind(statement)
    statement.bind = (...values) => wrap(bind(...values))
    return wrap(statement)
  }
})
afterEach(() => { db.close() })

it('지원서 상세는 권한 확인 뒤 첨부·채용내정·초대 코드를 한 단계로 읽는다', async () => {
  const response = await getApplication({ env: { DB: db }, data: { user: users.owner }, params: { id: 'application' } })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(JSON.stringify(body)).toContain('ABCD2345EFGH')
  // 권한 확인(1) → 첨부·채용내정·초대 코드(2~). 초대 코드를 따로 기다리면 한 단계 더였다.
  const withRoom = stages
  stages = 0
  db.sql.exec("UPDATE applications SET room_id = NULL WHERE id = 'application'")
  expect((await getApplication({ env: { DB: db }, data: { user: users.owner }, params: { id: 'application' } })).status).toBe(200)
  expect(withRoom).toBe(stages)
  stages = 0
  expect((await getApplication({ env: { DB: db }, data: { user: users.other }, params: { id: 'application' } })).status).toBe(403)
  expect(stages).toBe(1)
})

it('계약서 보관소 목록은 보관 목록과 미보관 건수를 함께 읽는다', async () => {
  const response = await getArchivedContracts({ env: { DB: db }, data: { user: users.admin } })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ contracts: [] })
  expect(stages).toBe(1)
})

it('계약 조건 저장은 권한 확인 뒤 방 상태와 기존 조건을 함께 읽는다', async () => {
  db.sql.exec("INSERT INTO room_participants (room_id, user_id, role_in_room) VALUES ('room', 'owner', 'company')")
  const { onRequestPatch } = await import('../server/api/rooms/[roomId]/contract.js')
  const response = await onRequestPatch({ env: { DB: db }, data: { user: users.owner }, params: { roomId: 'room' },
    request: new Request('https://test.invalid', { method: 'PATCH', body: JSON.stringify({ workLocation: '서울 본사' }) }) })
  expect(response.status).toBe(200)
  expect(db.sql.prepare("SELECT work_location FROM contract_terms WHERE room_id = 'room'").get().work_location).toBe('서울 본사')
  // 참여 확인(1) → 방 상태·기존 조건(2) → 저장·이력 등. 방 상태와 기존 조건을 차례로 읽으면 7단계였다.
  expect(stages).toBe(6)
})
