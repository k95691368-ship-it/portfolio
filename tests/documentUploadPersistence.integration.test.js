import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestPost as upload } from '../server/api/documents/upload.js'
import { onRequestDelete as deleteDocument } from '../server/api/documents/[id]/index.js'
import { processStorageCleanup } from '../server/_lib/storageCleanup.js'

const oldKey = 'documents/candidate/previous.pdf'
const pdf = name => `%PDF-1.7\nSynthetic ${name}\n%%EOF`
let db, user, objects, env
const deferred = () => {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}

beforeEach(() => {
  db = sqliteApp()
  user = seedUser(db, 'candidate')
  objects = new Map()
  env = { DB: db, DOCUMENTS: {
    put: vi.fn(async (key, body) => { objects.set(key, await new Response(body).text()) }),
    delete: vi.fn(async key => { objects.delete(key) }),
  } }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External access prohibited') }))
})
afterEach(() => { db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function seedPrevious() {
  objects.set(oldKey, pdf('previous'))
  db.sql.prepare(`INSERT INTO documents (id,user_id,doc_type,filename,r2_key,size_bytes,content_type)
    VALUES ('document','candidate','resume','previous.pdf',?,10,'application/pdf')`).run(oldKey)
}
function call(name = 'replacement.pdf') {
  const form = new FormData()
  form.set('docType', 'resume')
  form.set('file', new File([pdf(name)], name, { type: 'application/pdf' }))
  return upload({ env, data: { user }, request: new Request('https://test.invalid/documents/upload', { method: 'POST', body: form }) })
}
const live = () => db.sql.prepare('SELECT id, filename, r2_key FROM documents').get()
const receipts = () => db.sql.prepare('SELECT storage_key FROM storage_cleanup_intents ORDER BY storage_key').all()
const due = () => db.sql.exec("UPDATE storage_cleanup_intents SET not_before = datetime('now','-1 minute'), next_attempt_at = datetime('now','-1 minute')")

it('records a deferred exact key before storage accepts bytes, then acknowledges only that upload receipt', async () => {
  env.DOCUMENTS.put.mockImplementation(async (key, body) => {
    const receipt = db.sql.prepare('SELECT storage_key, julianday(not_before)-julianday(created_at) AS days FROM storage_cleanup_intents').get()
    expect(receipt.storage_key).toBe(key)
    expect(receipt.days).toBeCloseTo(2, 4)
    expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ pending: 0, deleted: 0 })
    objects.set(key, await new Response(body).text())
  })
  const response = await call()
  expect(response.status).toBe(201)
  expect((await response.json()).id).toBe(live().id)
  expect(objects.get(live().r2_key)).toBe(pdf('replacement.pdf'))
  expect(receipts()).toEqual([])
})

it.each([false, true])('does not upload when cleanup receipt acknowledgement fails (committed=%s)', async committed => {
  const prepare = db.prepare.bind(db)
  vi.spyOn(db, 'prepare').mockImplementation(source => {
    const statement = prepare(source)
    if (/INSERT INTO storage_cleanup_intents/.test(source)) {
      const run = statement.run.bind(statement)
      statement.run = async () => { if (committed) await run(); throw new Error('Synthetic receipt response loss') }
    }
    return statement
  })
  expect((await call()).status).toBe(503)
  expect(env.DOCUMENTS.put).not.toHaveBeenCalled()
  expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(receipts()).toHaveLength(Number(committed))
})

it('retains the retired key after a temporary delete outage, including after the candidate removes the current document', async () => {
  seedPrevious()
  env.DOCUMENTS.delete.mockRejectedValueOnce(new Error('Synthetic storage outage'))
  const response = await call()
  expect(response.status).toBe(201)
  expect(await response.json()).toMatchObject({ id: 'document', cleanupPending: true })
  expect(objects.size).toBe(2)
  expect(receipts()).toEqual([{ storage_key: oldKey }])
  const deletion = await deleteDocument({ env, data: { user }, params: { id: 'document' } })
  expect(await deletion.json()).toEqual({ ok: true, cleanupPending: false })
  expect(live()).toBeUndefined()
  expect(objects.has(oldKey)).toBe(true)
  due()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ deleted: 1, failed: 0 })
  expect(objects.size).toBe(0)
  expect(receipts()).toEqual([])
})

it.each([false, true])('retains the exact upload cleanup target after a lost PUT acknowledgement (previous=%s)', async previous => {
  if (previous) seedPrevious()
  env.DOCUMENTS.put.mockImplementation(async (key, body) => {
    objects.set(key, await new Response(body).text())
    throw new Error('Synthetic accepted PUT response loss')
  })
  expect((await call()).status).toBe(503)
  const key = env.DOCUMENTS.put.mock.calls[0][0]
  expect(receipts()).toEqual([{ storage_key: key }])
  expect(objects.has(key)).toBe(true)
  expect(live()?.r2_key).toBe(previous ? oldKey : undefined)
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ pending: 0, deleted: 0 })
  due()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ deleted: 1, failed: 0 })
  expect([...objects.keys()]).toEqual(previous ? [oldKey] : [])
})

it.each([
  { previous: false, committed: false }, { previous: false, committed: true },
  { previous: true, committed: false }, { previous: true, committed: true },
  { previous: true, committed: true, missingResponse: true },
])('preserves possibly committed bytes until delayed reference checks after a database response loss: %j', async outcome => {
  if (outcome.previous) seedPrevious()
  const batch = db.batch.bind(db)
  vi.spyOn(db, 'batch').mockImplementation(async statements => {
    if (!statements.some(statement => /INSERT INTO documents\b/.test(statement.source))) return batch(statements)
    if (outcome.committed) await batch(statements)
    if (outcome.missingResponse) return null
    throw new Error('Synthetic save acknowledgement loss')
  })
  expect((await call()).status).toBe(503)
  const key = env.DOCUMENTS.put.mock.calls[0][0]
  expect(objects.has(key)).toBe(true)
  expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(live()?.r2_key).toBe(outcome.committed ? key : outcome.previous ? oldKey : undefined)
  expect(receipts()).toHaveLength(1 + Number(outcome.previous && outcome.committed))
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ pending: 0, deleted: 0 })
  due()
  const cleanup = await processStorageCleanup(env, { dryRun: false })
  expect(cleanup).toMatchObject({ deleted: outcome.committed ? Number(outcome.previous) : 1, protected: Number(outcome.committed), failed: 0 })
  expect([...objects.keys()]).toEqual(outcome.committed ? [key] : outcome.previous ? [oldKey] : [])
})

it('does not remove an upload when an uncertain transaction commits after its error response', async () => {
  seedPrevious()
  const batch = db.batch.bind(db)
  let pendingStatements
  vi.spyOn(db, 'batch').mockImplementation(async statements => {
    if (!statements.some(statement => /INSERT INTO documents\b/.test(statement.source))) return batch(statements)
    pendingStatements = statements
    throw new Error('Synthetic unresolved transaction')
  })
  expect((await call()).status).toBe(503)
  const key = env.DOCUMENTS.put.mock.calls[0][0]
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ pending: 0, deleted: 0 })
  expect(objects.has(key)).toBe(true)
  await batch(pendingStatements)
  due()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ protected: 1, deleted: 1, failed: 0 })
  expect(live().r2_key).toBe(key)
  expect([...objects.keys()]).toEqual([key])
})

it('keeps both cleanup targets deferred if the committed save ID is missing from its acknowledgement', async () => {
  seedPrevious()
  const batch = db.batch.bind(db)
  vi.spyOn(db, 'batch').mockImplementation(async statements => {
    const result = await batch(statements)
    if (statements.some(statement => /INSERT INTO documents\b/.test(statement.source))) result[3].results = []
    return result
  })
  expect((await call()).status).toBe(503)
  const key = env.DOCUMENTS.put.mock.calls[0][0]
  expect(live().r2_key).toBe(key)
  expect(receipts()).toHaveLength(2)
  expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ pending: 0, deleted: 0 })
  due()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ protected: 1, deleted: 1, failed: 0 })
  expect([...objects.keys()]).toEqual([key])
})

it('returns its own saved ID when another request deletes it and uploads a new row before the first save resumes', async () => {
  const batch = db.batch.bind(db)
  let originalId, replacementBody, replaced = false
  vi.spyOn(db, 'batch').mockImplementation(async statements => {
    const result = await batch(statements)
    if (!replaced && statements.some(statement => /INSERT INTO documents\b/.test(statement.source))) {
      replaced = true
      originalId = live().id
      const deletion = await deleteDocument({ env, data: { user }, params: { id: originalId } })
      expect(deletion.status).toBe(200)
      const replacement = await call('later.pdf')
      expect(replacement.status).toBe(201)
      replacementBody = await replacement.json()
    }
    return result
  })
  const response = await call('earlier.pdf')
  expect(response.status).toBe(201)
  expect(await response.json()).toMatchObject({ id: originalId, filename: 'earlier.pdf' })
  expect(replacementBody.id).not.toBe(originalId)
  expect(live()).toMatchObject({ id: replacementBody.id, filename: 'later.pdf' })
  expect(objects.size).toBe(1)
  expect(receipts()).toEqual([])
})

it.each([false, true])('keeps storage cleanup recoverable if its acknowledgement is lost (committed=%s)', async committed => {
  seedPrevious()
  const batch = db.batch.bind(db)
  vi.spyOn(db, 'batch').mockImplementation(async statements => {
    if (!statements.some(statement => /DELETE FROM storage_cleanup_intents/.test(statement.source))) return batch(statements)
    if (committed) await batch(statements)
    throw new Error('Synthetic cleanup acknowledgement loss')
  })
  const response = await call()
  expect(response.status).toBe(201)
  expect(await response.json()).toMatchObject({ id: 'document', cleanupPending: !committed })
  const key = live().r2_key
  expect(objects.has(key)).toBe(true)
  expect(objects.has(oldKey)).toBe(!committed)
  due()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ protected: Number(!committed), deleted: Number(!committed), failed: 0 })
  expect([...objects.keys()]).toEqual([key])
})

it.each(['application', 'archive'])('protects a predecessor still referenced by a %s', async reference => {
  seedPrevious()
  if (reference === 'archive') {
    db.sql.prepare(`INSERT INTO contract_archive (id,room_id,terms_json,signatures_json,document_key,document_sha256,document_bytes)
      VALUES ('archive','room','{}','[]',?,'synthetic',10)`).run(oldKey)
  } else {
    db.sql.exec(`INSERT INTO job_postings (id,created_by_user_id,title,description) VALUES ('posting','candidate','Synthetic','Synthetic');
      INSERT INTO applications (id,posting_id,applicant_name,applicant_email,applicant_phone)
        VALUES ('application','posting','Synthetic','candidate@example.invalid','000');`)
    db.sql.prepare(`INSERT INTO application_documents (id,application_id,doc_type,filename,r2_key,size_bytes,content_type)
      VALUES ('attachment','application','resume','previous.pdf',?,10,'application/pdf')`).run(oldKey)
  }
  expect((await call()).status).toBe(201)
  expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(objects.has(oldKey)).toBe(true)
  expect(receipts()).toEqual([{ storage_key: oldKey }])
})

it.each([false, true])('captures the actual predecessor after both PUTs prepare before either saves (previous=%s)', async previous => {
  if (previous) seedPrevious()
  const ready = deferred(), puts = new Map()
  env.DOCUMENTS.put.mockImplementation(async (key, body) => {
    const bytes = await new Response(body).text(), release = deferred()
    puts.set(bytes, () => { objects.set(key, bytes); release.resolve() })
    if (puts.size === 2) ready.resolve()
    return release.promise
  })
  const first = call('first.pdf'), second = call('second.pdf')
  await ready.promise
  expect(puts.size).toBe(2)
  puts.get(pdf('first.pdf'))()
  expect((await first).status).toBe(201)
  const firstKey = live().r2_key
  env.DOCUMENTS.delete.mockRejectedValueOnce(new Error('Synthetic predecessor delete outage'))
  puts.get(pdf('second.pdf'))()
  expect((await second).status).toBe(201)
  expect(objects.get(live().r2_key)).toBe(pdf('second.pdf'))
  expect(receipts()).toEqual([{ storage_key: firstKey }])
  due()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ deleted: 1, failed: 0 })
  expect(objects.size).toBe(1)
  expect(receipts()).toEqual([])
})

it('does not acknowledge a newer replacement receipt assigned to the same key', async () => {
  const batch = db.batch.bind(db)
  vi.spyOn(db, 'batch').mockImplementation(async statements => {
    const result = await batch(statements)
    if (statements.some(statement => /INSERT INTO documents\b/.test(statement.source))) {
      db.sql.prepare("UPDATE storage_cleanup_intents SET operation_id = 'newer-operation' WHERE storage_key = ?").run(live().r2_key)
    }
    return result
  })
  expect((await call()).status).toBe(201)
  expect(db.sql.prepare('SELECT operation_id FROM storage_cleanup_intents').get().operation_id).toBe('newer-operation')
  due()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ protected: 1, deleted: 0 })
  expect(objects.has(live().r2_key)).toBe(true)
})
