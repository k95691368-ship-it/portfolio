import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Live database access prohibited') } }))
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { onRequestPost as upload } from '../server/api/documents/upload.js'
import { onRequestDelete as deleteDocument } from '../server/api/documents/[id]/index.js'
import { processStorageCleanup } from '../server/_lib/storageCleanup.js'

const user = { id: 'candidate', role: 'candidate' }
const oldKey = 'documents/candidate/previous.pdf'
const pdf = name => `%PDF-1.7\nSynthetic ${name}\n%%EOF`
let pg, db, env, objects, saveOutcome
function adapter(client) {
  return {
    async unsafe(query, values = []) {
      if (saveOutcome === 'rollback' && /INSERT INTO documents\b/i.test(query)) throw new Error('Synthetic PostgreSQL save failure')
      const result = await client.query(query, values)
      return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length })
    },
    async begin(operation) {
      let saving = false
      const result = await client.transaction(async transaction => {
        const wrapped = adapter(transaction), unsafe = wrapped.unsafe
        wrapped.unsafe = (query, values) => {
          saving ||= /INSERT INTO documents\b/i.test(query)
          return unsafe(query, values)
        }
        return operation(wrapped)
      })
      if (saving && saveOutcome === 'lost') throw new Error('Synthetic lost PostgreSQL commit acknowledgement')
      return result
    },
  }
}
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage; CREATE TABLE storage.buckets (id TEXT PRIMARY KEY,name TEXT,public BOOLEAN,file_size_limit BIGINT);')
  for (const file of readdirSync('supabase/migrations').filter(name => name.endsWith('.sql') && name !== '202609130002_retention_schedule.sql').sort()) {
    await pg.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  }
  db = new PostgresD1(adapter(pg))
}, 30000)
beforeEach(async () => {
  saveOutcome = 'acknowledged'
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('External access prohibited') })
  await pg.exec(`TRUNCATE users CASCADE; TRUNCATE storage_cleanup_intents, contract_archive;
    INSERT INTO users (id,email,password_hash,password_salt,role,display_name)
      VALUES ('candidate','candidate@example.invalid','unused','unused','candidate','Synthetic candidate');`)
  objects = new Map()
  env = { DB: db, DOCUMENTS: {
    put: vi.fn(async (key, body) => {
      const receipt = (await pg.query('SELECT storage_key, julianday(not_before)-julianday(created_at) AS days FROM storage_cleanup_intents WHERE storage_key = $1', [key])).rows[0]
      expect(receipt.storage_key).toBe(key)
      expect(receipt.days).toBeCloseTo(2, 4)
      objects.set(key, await new Response(body).text())
    }),
    delete: vi.fn(async key => { objects.delete(key) }),
  } }
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => { await pg?.close() })

async function seedPrevious() {
  objects.set(oldKey, pdf('previous'))
  await pg.query(`INSERT INTO documents (id,user_id,doc_type,filename,r2_key,size_bytes,content_type)
    VALUES ('document','candidate','resume','previous.pdf',$1,10,'application/pdf')`, [oldKey])
}
function call(name = 'replacement.pdf') {
  const form = new FormData()
  form.set('docType', 'resume')
  form.set('file', new File([pdf(name)], name, { type: 'application/pdf' }))
  return upload({ env, data: { user }, request: new Request('https://test.invalid/documents/upload', { method: 'POST', body: form }) })
}
const live = async () => (await pg.query('SELECT id, filename, r2_key FROM documents')).rows[0]
const receipts = async () => (await pg.query('SELECT storage_key FROM storage_cleanup_intents ORDER BY storage_key')).rows
const due = () => pg.exec("UPDATE storage_cleanup_intents SET not_before = datetime('now','-1 minute'), next_attempt_at = datetime('now','-1 minute')")

it.each([
  { previous: false, outcome: 'acknowledged' }, { previous: true, outcome: 'acknowledged' },
  { previous: false, outcome: 'rollback' }, { previous: true, outcome: 'rollback' },
  { previous: false, outcome: 'lost' }, { previous: true, outcome: 'lost' },
])('preserves the correct live bytes and retires only unreferenced keys through PostgresD1: %j', async example => {
  if (example.previous) await seedPrevious()
  saveOutcome = example.outcome
  const response = await call()
  const key = env.DOCUMENTS.put.mock.calls[0][0]
  expect(response.status).toBe(example.outcome === 'acknowledged' ? 201 : 503)
  if (example.outcome === 'acknowledged') {
    const body = await response.json()
    expect(body.id).toBe((await live()).id)
    if (example.previous) expect(body.id).toBe('document')
    expect(body.cleanupPending).toBe(false)
    expect(await receipts()).toEqual([])
  } else {
    expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
    expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ pending: 0, deleted: 0 })
    expect(await receipts()).toHaveLength(1 + Number(example.previous && example.outcome === 'lost'))
    await due()
    expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({
      deleted: example.outcome === 'lost' ? Number(example.previous) : 1,
      protected: Number(example.outcome === 'lost'), failed: 0,
    })
  }
  const liveKey = example.outcome === 'rollback' ? example.previous ? oldKey : undefined : key
  expect((await live())?.r2_key).toBe(liveKey)
  expect([...objects.keys()]).toEqual(liveKey ? [liveKey] : [])
})

it('does not upload without an acknowledged PostgreSQL cleanup receipt', async () => {
  const unsafe = db.client.unsafe.bind(db.client)
  vi.spyOn(db.client, 'unsafe').mockImplementation((query, values) => {
    if (/INSERT INTO storage_cleanup_intents/.test(query)) throw new Error('Synthetic receipt failure')
    return unsafe(query, values)
  })
  expect((await call()).status).toBe(503)
  expect(env.DOCUMENTS.put).not.toHaveBeenCalled()
  expect(await receipts()).toEqual([])
})

it('leaves an accepted PUT with a lost acknowledgement deferred until cleanup can confirm it is unreferenced', async () => {
  await seedPrevious()
  const put = env.DOCUMENTS.put.getMockImplementation()
  env.DOCUMENTS.put.mockImplementation(async (key, body) => { await put(key, body); throw new Error('Synthetic PUT acknowledgement loss') })
  expect((await call()).status).toBe(503)
  const key = env.DOCUMENTS.put.mock.calls[0][0]
  expect((await live()).r2_key).toBe(oldKey)
  expect(await receipts()).toEqual([{ storage_key: key }])
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ pending: 0, deleted: 0 })
  await due()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ deleted: 1, failed: 0 })
  expect([...objects.keys()]).toEqual([oldKey])
})

it('retains a PostgreSQL predecessor cleanup receipt after deletion fails and retries it later', async () => {
  await seedPrevious()
  env.DOCUMENTS.delete.mockRejectedValueOnce(new Error('Synthetic storage outage'))
  const response = await call()
  expect(response.status).toBe(201)
  expect(await response.json()).toMatchObject({ id: 'document', cleanupPending: true })
  expect(await receipts()).toEqual([{ storage_key: oldKey }])
  expect(objects.size).toBe(2)
  await due()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ deleted: 1, failed: 0 })
  expect(objects.size).toBe(1)
  expect(await receipts()).toEqual([])
})

it('keeps the PostgreSQL transaction ID after another request deletes the row and uploads its successor', async () => {
  const batch = db.batch.bind(db)
  let originalId, replacementBody, replaced = false
  vi.spyOn(db, 'batch').mockImplementation(async statements => {
    const result = await batch(statements)
    if (!replaced && statements.some(statement => /INSERT INTO documents\b/.test(statement.source))) {
      replaced = true
      originalId = (await live()).id
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
  expect(await live()).toMatchObject({ id: replacementBody.id, filename: 'later.pdf' })
  expect(objects.size).toBe(1)
  expect(await receipts()).toEqual([])
})

it.each(['application', 'archive'])('protects predecessor bytes referenced by a PostgreSQL %s', async reference => {
  await seedPrevious()
  if (reference === 'archive') {
    await pg.query(`INSERT INTO contract_archive (id,room_id,terms_json,signatures_json,document_key,document_sha256,document_bytes)
      VALUES ('archive','room','{}','[]',$1,'synthetic',10)`, [oldKey])
  } else {
    await pg.exec(`INSERT INTO job_postings (id,created_by_user_id,title,description) VALUES ('posting','candidate','Synthetic','Synthetic');
      INSERT INTO applications (id,posting_id,applicant_name,applicant_email,applicant_phone)
        VALUES ('application','posting','Synthetic','candidate@example.invalid','000');`)
    await pg.query(`INSERT INTO application_documents (id,application_id,doc_type,filename,r2_key,size_bytes,content_type)
      VALUES ('attachment','application','resume','previous.pdf',$1,10,'application/pdf')`, [oldKey])
  }
  expect((await call()).status).toBe(201)
  expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(objects.has(oldKey)).toBe(true)
  expect(await receipts()).toEqual([{ storage_key: oldKey }])
})

it.each([false, true])('captures the actual PostgreSQL predecessor when both PUTs prepare before serial saves (previous=%s)', async previous => {
  if (previous) await seedPrevious()
  let ready
  const prepared = new Promise(resolve => { ready = resolve }), puts = new Map()
  env.DOCUMENTS.put.mockImplementation(async (key, body) => {
    const bytes = await new Response(body).text()
    return new Promise(resolve => {
      puts.set(bytes, () => { objects.set(key, bytes); resolve() })
      if (puts.size === 2) ready()
    })
  })
  const first = call('first.pdf'), second = call('second.pdf')
  await prepared
  expect(puts.size).toBe(2)
  puts.get(pdf('first.pdf'))()
  expect((await first).status).toBe(201)
  const firstKey = (await live()).r2_key
  env.DOCUMENTS.delete.mockRejectedValueOnce(new Error('Synthetic predecessor deletion failure'))
  puts.get(pdf('second.pdf'))()
  expect((await second).status).toBe(201)
  expect(objects.get((await live()).r2_key)).toBe(pdf('second.pdf'))
  expect(await receipts()).toEqual([{ storage_key: firstKey }])
  await due()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ deleted: 1, failed: 0 })
  expect(objects.size).toBe(1)
  expect(await receipts()).toEqual([])
})
