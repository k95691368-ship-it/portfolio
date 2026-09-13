import { createServer } from 'node:http'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequest } from '../server/api/_middleware.js'
import { onRequestPost } from '../server/api/jobs/[id]/apply.js'
import { CONSENT_VERSION, CONSENT_SNAPSHOT } from '../src/lib/consentText.js'

let db, server, base, documents
beforeEach(async () => {
  db = sqliteApp(); seedUser(db, 'owner', 'company')
  db.sql.exec("INSERT INTO job_postings (id,title,description,created_by_user_id,status) VALUES ('posting','Test role','Test details','owner','open')")
  documents = { put: vi.fn(async () => {}), delete: vi.fn(async () => {}) }
  server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = []
      for await (const chunk of incoming) chunks.push(chunk)
      const context = {
        request: new Request(`${base}${incoming.url}`, { method: incoming.method, headers: incoming.headers, body: Buffer.concat(chunks) }),
        env: { DB: db, DOCUMENTS: documents }, params: { id: 'posting' }, data: {},
      }
      context.next = () => onRequestPost(context)
      const result = await onRequest(context)
      outgoing.writeHead(result.status, Object.fromEntries(result.headers))
      outgoing.end(Buffer.from(await result.arrayBuffer()))
    } catch (error) { outgoing.writeHead(500); outgoing.end(error.message) }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  db.close()
})
function form(extra = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries({ applicantName: 'Test', applicantEmail: 'candidate@example.invalid', applicantPhone: '01012345678', consentRequired: 'true', consentOptional: 'false', consentVersion: CONSENT_VERSION, ...extra })) data.set(key, value)
  data.set('resume', new File(['%PDF-1.4\nfixture\n%%EOF'], 'resume.pdf', { type: 'application/pdf' }))
  return data
}
const submit = (body) => fetch(`${base}/api/jobs/posting/apply`, { method: 'POST', body })

it('real multipart HTTP accepts required-only consent and stores the exact notice', async () => {
  const result = await submit(form())
  expect(result.status).toBe(201)
  expect((await result.json()).lookupCode).toHaveLength(10)
  const saved = db.sql.prepare('SELECT * FROM applications').get()
  expect(saved.consent_version).toBe(CONSENT_VERSION)
  expect(saved.consent_snapshot).toBe(CONSENT_SNAPSHOT)
  expect(saved.consent_optional).toBe(0)
  expect(saved.consent_third_party).toBe(0)
  expect(documents.put).toHaveBeenCalledTimes(1)
})
it('rejects optional data without consent before storage, then accepts explicit consent', async () => {
  expect((await submit(form({ coverLetter: 'Optional content' }))).status).toBe(400)
  expect(documents.put).not.toHaveBeenCalled()
  expect((await submit(form({ coverLetter: 'Optional content', consentOptional: 'true' }))).status).toBe(201)
  expect(db.sql.prepare('SELECT consent_optional FROM applications').get().consent_optional).toBe(1)
})
it('rejects a stale consent notice without storing files or an application', async () => {
  expect((await submit(form({ consentVersion: 'old' }))).status).toBe(409)
  expect(documents.put).not.toHaveBeenCalled()
  expect(db.sql.prepare('SELECT count(*) n FROM applications').get().n).toBe(0)
})
