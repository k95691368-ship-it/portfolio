import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as upload } from '../server/api/documents/upload.js'
import { archiveContract } from '../server/_lib/contractArchive.js'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'

const databases = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const db of databases.splice(0)) db.close()
})

function fixture() {
  const db = sqliteApp()
  databases.push(db)
  const user = seedUser(db, 'upload-owner')
  const objects = new Map()
  const bucket = {
    put: vi.fn(async (key, body) => objects.set(key, await new Response(body).text())),
    delete: vi.fn(async (key) => objects.delete(key)),
  }
  const env = { DB: db, DOCUMENTS: bucket }
  const call = (name = 'resume.pdf') => {
    const body = new FormData()
    body.set('docType', 'resume')
    body.set('file', new File([`%PDF-1.7\n${name}\n%%EOF`], name, { type: 'application/pdf' }))
    return upload({ env, data: { user }, request: new Request('https://test.invalid/api/documents/upload', { method: 'POST', body }) })
  }
  return { db, user, objects, bucket, env, call }
}

function failWrite(db, table, { afterCommit = false, failAt = 1 } = {}) {
  const original = db.prepare.bind(db)
  let writes = 0
  vi.spyOn(db, 'prepare').mockImplementation((source) => {
    const statement = original(source)
    if (new RegExp(`INSERT INTO ${table}\\b`).test(source)) {
      const first = statement.first.bind(statement)
      statement.first = async () => {
        if (++writes !== failAt) return first()
        if (afterCommit) await first()
        throw new Error('Simulated database response failure')
      }
    }
    return statement
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
}

describe('document upload isolation', () => {
  it('uses unique keys within one clock tick and returns the persisted document ID on replacement', async () => {
    const { call, db, objects, bucket } = fixture()
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    const first = await (await call('first.pdf')).json()
    const second = await (await call('second.pdf')).json()
    const row = db.sql.prepare('SELECT id, filename, r2_key FROM documents').get()
    expect(second.id).toBe(first.id)
    expect(row).toMatchObject({ id: second.id, filename: 'second.pdf' })
    expect(new Set(bucket.put.mock.calls.map(([key]) => key)).size).toBe(2)
    expect(objects.size).toBe(1)
    expect(objects.get(row.r2_key)).toContain('second.pdf')
  })

  it('keeps simultaneous uploads in distinct objects, with the final database reference intact', async () => {
    const { call, db, objects, bucket } = fixture()
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => call(`${i}.pdf`)))
    expect(responses.every((response) => response.status === 201)).toBe(true)
    expect(new Set(bucket.put.mock.calls.map(([key]) => key)).size).toBe(12)
    const row = db.sql.prepare('SELECT id, r2_key, filename FROM documents').get()
    const bodies = await Promise.all(responses.map((response) => response.json()))
    expect(bodies.every((body) => body.id === row.id)).toBe(true)
    expect(objects.get(row.r2_key)).toContain(row.filename)
  })

  it.each([false, true])('does not delete a possibly committed file after a database response failure (committed=%s)', async (afterCommit) => {
    const { call, db, objects, bucket } = fixture()
    await call('original.pdf')
    const originalKey = db.sql.prepare('SELECT r2_key FROM documents').get().r2_key
    failWrite(db, 'documents', { afterCommit })
    const response = await call('replacement.pdf')
    expect(response.status).toBe(503)
    expect(bucket.delete).not.toHaveBeenCalled()
    expect(objects.has(originalKey)).toBe(true)
    const row = db.sql.prepare('SELECT r2_key, filename FROM documents').get()
    expect(objects.get(row.r2_key)).toContain(afterCommit ? 'replacement.pdf' : 'original.pdf')
  })

  it('does not let one failed concurrent request remove the successful request file', async () => {
    const { call, db, objects, bucket } = fixture()
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    failWrite(db, 'documents', { failAt: 2 })
    const responses = await Promise.all([call('winner.pdf'), call('failed.pdf')])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 503])
    expect(new Set(bucket.put.mock.calls.map(([key]) => key)).size).toBe(2)
    const row = db.sql.prepare('SELECT r2_key, filename FROM documents').get()
    expect(objects.get(row.r2_key)).toContain(row.filename)
  })

  it('does not upload without a candidate account', async () => {
    const { env, user, bucket } = fixture()
    for (const [account, status] of [[null, 401], [{ ...user, role: 'company' }, 403]]) {
      const response = await upload({ env, data: { user: account }, request: new Request('https://test.invalid/') })
      expect(response.status).toBe(status)
    }
    expect(bucket.put).not.toHaveBeenCalled()
  })
})

function archiveFixture() {
  const context = fixture()
  const { db, user } = context
  db.sql.prepare("INSERT INTO interview_rooms (id,company_user_id,title,invite_code,status) VALUES ('archive-fixture',?,'Disposable test','ARCHIVEFIXTURE','signed')").run(user.id)
  db.sql.exec("INSERT INTO contract_terms (room_id,employer_name,employee_name) VALUES ('archive-fixture','Test employer','Test employee')")
  return { ...context, archive: () => archiveContract(context.env, 'archive-fixture') }
}

describe('contract archive upload isolation', () => {
  it('uses distinct keys for concurrent replacement of the same archive in one clock tick', async () => {
    const { archive, db, objects, bucket } = archiveFixture()
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    const original = await archive()
    const results = await Promise.all([archive(), archive()])
    expect(results.every((result) => result.ok && result.id === original.id)).toBe(true)
    expect(new Set(bucket.put.mock.calls.map(([key]) => key)).size).toBe(3)
    const row = db.sql.prepare('SELECT document_key FROM contract_archive').get()
    expect(objects.get(row.document_key)).toContain('Test employee')
  })

  it('preserves a committed signed document when the database acknowledgement is lost', async () => {
    const { archive, db, objects, bucket } = archiveFixture()
    await archive()
    failWrite(db, 'contract_archive', { afterCommit: true })
    expect((await archive()).ok).toBe(false)
    const row = db.sql.prepare('SELECT document_key FROM contract_archive').get()
    expect(objects.get(row.document_key)).toContain('Test employee')
    expect(bucket.delete).not.toHaveBeenCalled()
  })
})
