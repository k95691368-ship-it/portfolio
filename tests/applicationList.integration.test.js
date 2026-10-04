import { afterEach, beforeEach, expect, it } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestGet as list } from '../server/api/applications/index.js'
import { onRequestGet as compare } from '../server/api/postings/[id]/applications.js'

let db, owner, other
beforeEach(() => {
  db = sqliteApp()
  owner = seedUser(db, 'owner', 'company', { recruiter: 1 })
  other = seedUser(db, 'other', 'company', { recruiter: 1 })
  db.sql.exec("INSERT INTO job_postings(id,created_by_user_id,title,description) VALUES('posting','owner','Role','Description'),('other-posting','other','Private role','Description')")
})
afterEach(() => db.close())
const context = (query = '', user = owner) => ({ env: { DB: db }, data: { user }, params: { id: 'posting' }, request: new Request(`https://test.invalid/api/applications${query ? `?${query}` : ''}`) })
const read = async (query = '', user = owner) => {
  const response = await list(context(query, user))
  return { status: response.status, ...await response.json() }
}
function seed(count, options = {}) {
  const statement = db.sql.prepare("INSERT INTO applications(id,posting_id,applicant_name,applicant_email,applicant_phone,status,created_at,consent_required) VALUES(?,?,?,?,?,?,?,1)")
  for (let i = 0; i < count; i++) statement.run(`app-${String(i).padStart(4, '0')}`, options.posting || 'posting', i === 0 ? (options.name || 'Old candidate') : `Candidate ${i}`,
    `candidate-${options.posting || 'posting'}-${i}@example.invalid`, '010', options.status || (i === 0 ? 'submitted' : 'rejected'),
    options.sameDate ? '2026-01-01T00:00:00Z' : new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString())
}

it('finds the oldest pending applicant beyond the former 500-row cap and outside the 300-person comparison', async () => {
  seed(501)
  const first = await read()
  expect(first.applications).toHaveLength(100)
  expect(first.applications.some(row => row.id === 'app-0000')).toBe(false)
  const comparison = await (await compare(context())).json()
  expect(comparison.applicants).toHaveLength(300)
  expect(comparison.applicants.some(row => row.id === 'app-0000')).toBe(false)
  expect((await read('status=submitted')).applications.map(row => row.id)).toEqual(['app-0000'])
  expect((await read('q=Old&posting=posting')).applications.map(row => row.id)).toEqual(['app-0000'])
  const ids = first.applications.map(row => row.id)
  let cursor = first.nextCursor
  while (cursor) {
    const next = await read(`cursor=${encodeURIComponent(cursor)}`)
    ids.push(...next.applications.map(row => row.id))
    cursor = next.nextCursor
  }
  expect(ids).toHaveLength(501)
  expect(new Set(ids).size).toBe(501)
  expect(ids[500]).toBe('app-0000')
})

it('uses the id to traverse equal timestamps without missing or repeating a pending applicant', async () => {
  seed(201, { sameDate: true, status: 'submitted' })
  const ids = []
  let cursor
  do {
    const page = await read(`status=submitted${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    ids.push(...page.applications.map(row => row.id))
    cursor = page.nextCursor
  } while (cursor)
  expect(ids).toEqual(Array.from({ length: 201 }, (_, index) => `app-${String(200 - index).padStart(4, '0')}`))
})

it('scopes every page and search to the owner and rejects a cursor moved to another owner or filter', async () => {
  seed(101)
  db.sql.exec("INSERT INTO applications(id,posting_id,applicant_name,applicant_email,applicant_phone,consent_required) VALUES('private','other-posting','Hidden','hidden@example.invalid','010',1)")
  const first = await read()
  expect((await read('q=Hidden')).applications).toEqual([])
  expect((await read('posting=other-posting')).applications).toEqual([])
  expect((await read(`cursor=${first.nextCursor}`, other)).status).toBe(400)
  expect((await read(`status=submitted&cursor=${first.nextCursor}`)).status).toBe(400)
  expect((await read(`cursor=${first.nextCursor}`)).applications).toHaveLength(1)
  expect((await read('', null)).status).toBe(401)
  expect((await read('', { id: 'candidate', role: 'candidate' })).status).toBe(403)
  expect((await read('q=Hidden', { ...owner, is_admin: 1 })).applications.map(row => row.id)).toEqual(['private'])
})

it('treats search wildcards literally, filters withdrawn rows separately, and reports an exact empty/end state', async () => {
  seed(1, { name: '50%_done\\candidate' })
  expect((await read('q=%25')).applications).toHaveLength(1)
  expect((await read('q=_done')).applications).toHaveLength(1)
  expect((await read('q=missing')).applications).toEqual([])
  db.sql.exec("UPDATE applications SET withdrawn_at='2026-01-02' WHERE id='app-0000'")
  expect((await read('status=submitted')).applications).toEqual([])
  const withdrawn = await read('status=withdrawn')
  expect(withdrawn.applications[0].status).toBe('withdrawn')
  expect(withdrawn.nextCursor).toBeNull()
  expect(withdrawn.truncated).toBe(false)
  expect((await read('status=unexpected')).status).toBe(400)
  expect((await read('cursor=not-a-cursor')).status).toBe(400)
})

it('does not call exactly 100 rows truncated, and never includes a newly inserted first row twice on a later page', async () => {
  seed(100, { sameDate: true })
  expect(await read()).toMatchObject({ truncated: false, nextCursor: null })
  db.sql.exec("INSERT INTO applications(id,posting_id,applicant_name,applicant_email,applicant_phone,created_at,consent_required) VALUES('app-extra','posting','Extra','extra@example.invalid','010','2026-01-01T00:00:00Z',1)")
  const first = await read()
  db.sql.exec("INSERT INTO applications(id,posting_id,applicant_name,applicant_email,applicant_phone,created_at,consent_required) VALUES('new-first','posting','Newest','newest@example.invalid','010','2026-02-01T00:00:00Z',1)")
  const next = await read(`cursor=${first.nextCursor}`)
  expect([...first.applications, ...next.applications]).toHaveLength(101)
  expect(next.applications.map(row => row.id)).toEqual(['app-0000'])
})
