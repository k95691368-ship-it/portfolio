import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'

vi.mock('../server/_lib/email.js', async original => ({
  ...await original(),
  isEmailConfigured: () => true,
  sendSignedContractEmail: vi.fn(async () => ({ id: 'synthetic-mail' })),
}))

import { sendSignedContractEmail } from '../server/_lib/email.js'
import { onRequestPost as storeContract, onRequestGet as readContract } from '../server/api/rooms/[roomId]/signed-contract.js'
import { onRequestGet as downloadContract } from '../server/api/rooms/[roomId]/signed-contract-file.js'
import { onRequestPost as archiveRoom } from '../server/api/rooms/[roomId]/archive.js'
import { processStorageCleanup } from '../server/_lib/storageCleanup.js'
import { runRetention } from '../server/_lib/retention.js'

const oldKey = 'contracts/room/previous.pdf'
const oldPdf = '%PDF-1.7\nprevious signed contract\n%%EOF'
const newPdf = '%PDF-1.7\nnew signed contract\n%%EOF'
const hash = value => createHash('sha256').update(value).digest('hex')
let db, env, company, objects

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External requests are disabled in this test') }))
  db = sqliteApp()
  company = seedUser(db, 'company', 'company')
  seedUser(db, 'candidate')
  db.sql.exec(`INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code)
    VALUES ('room','company','Synthetic contract','signed','ABCD2345EFGH');
    INSERT INTO room_participants (room_id,user_id,role_in_room)
    VALUES ('room','company','company'),('room','candidate','candidate');`)
  objects = new Map()
  env = {
    DB: db,
    DOCUMENTS: {
      put: vi.fn(async (key, bytes) => { objects.set(key, new Uint8Array(bytes).slice()) }),
      get: vi.fn(async key => objects.has(key) ? { body: objects.get(key) } : null),
      delete: vi.fn(async key => { objects.delete(key) }),
    },
  }
})

afterEach(() => { db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function seedStoredContract() {
  objects.set(oldKey, new TextEncoder().encode(oldPdf))
  db.sql.prepare(`INSERT INTO signed_contracts
    (id,room_id,r2_key,filename,size_bytes,stored_by_user_id,email_status,sha256_hash)
    VALUES ('stored','room',?,'previous.pdf',?,'company','sent',?)`)
    .run(oldKey, objects.get(oldKey).byteLength, hash(oldPdf))
}

function context(pdf = newPdf) {
  const form = new FormData()
  form.set('pdf', new Blob([pdf], { type: 'application/pdf' }), 'contract.pdf')
  return {
    env, data: { user: company }, params: { roomId: 'room' },
    request: new Request('https://test.invalid/api/rooms/room/signed-contract', { method: 'POST', body: form }),
  }
}

function uncertainWrite({ committed, missingResponse = false }) {
  const batch = db.batch.bind(db)
  vi.spyOn(db, 'batch').mockImplementation(async statements => {
    if (statements.some(statement => /INSERT INTO signed_contracts/.test(statement.source))) {
      if (committed) await batch(statements)
      if (missingResponse) return null
      throw new Error('Synthetic database response loss')
    }
    return batch(statements)
  })
}

const receipts = () => db.sql.prepare('SELECT storage_key FROM storage_cleanup_intents ORDER BY storage_key').all()
const due = () => db.sql.exec("UPDATE storage_cleanup_intents SET not_before = datetime('now','-1 minute'), next_attempt_at = datetime('now','-1 minute')")

it.each([
  { existing: false, committed: false },
  { existing: false, committed: true },
  { existing: true, committed: false },
  { existing: true, committed: true },
  { existing: true, committed: true, missingResponse: true },
])('preserves recoverable PDFs when the save is uncertain: %j', async scenario => {
  if (scenario.existing) seedStoredContract()
  uncertainWrite(scenario)
  const response = await storeContract(context())
  const uploadedKey = env.DOCUMENTS.put.mock.calls[0][0]
  expect(objects.has(uploadedKey)).toBe(true)
  if (scenario.existing) expect(objects.has(oldKey)).toBe(true)
  expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(response.status).toBe(503)
  expect((await response.json()).error).toBe('계약서 저장 결과를 확인하지 못했습니다. 계약서를 다시 불러와 저장 상태를 확인해주세요. 이번 요청에서는 이메일을 전송하지 않았습니다.')
  expect(sendSignedContractEmail).not.toHaveBeenCalled()
  expect(db.sql.prepare('SELECT count(*) n FROM notifications').get().n).toBe(0)
  expect(db.sql.prepare('SELECT count(*) n FROM contract_deliveries').get().n).toBe(0)

  const stored = (await (await readContract(context())).json()).stored
  const download = await downloadContract(context())
  if (scenario.committed || scenario.existing) {
    const expectedPdf = scenario.committed ? newPdf : oldPdf
    expect(download.status).toBe(200)
    expect(await download.text()).toBe(expectedPdf)
    expect(stored.sha256Hash).toBe(hash(expectedPdf))
    expect(stored.emailStatus).toBe(scenario.committed ? 'not_sent' : 'sent')
  } else {
    expect(download.status).toBe(404)
    expect(stored).toBeNull()
  }
  // No cleanup is allowed while the save acknowledgement remains uncertain.
  expect((await runRetention(env, { dryRun: false })).storageCleanup.deleted).toBe(0)
  expect(objects.has(uploadedKey)).toBe(true)
  if (scenario.existing) expect(objects.has(oldKey)).toBe(true)
  expect(receipts()).toHaveLength(scenario.existing && scenario.committed ? 2 : 1)

  due()
  const report = (await runRetention(env, { dryRun: false })).storageCleanup
  expect(report.failed).toBe(0)
  const liveKey = db.sql.prepare('SELECT r2_key FROM signed_contracts').get()?.r2_key
  expect([...objects.keys()]).toEqual(liveKey ? [liveKey] : [])
  expect(report.deleted).toBe(scenario.committed ? Number(scenario.existing) : 1)
  expect(report.protected).toBe(Number(scenario.committed))
})

it('replaces the old PDF and sends email only after an acknowledged save', async () => {
  seedStoredContract()
  const response = await storeContract(context())
  expect(response.status).toBe(201)
  const uploadedKey = env.DOCUMENTS.put.mock.calls[0][0]
  expect(objects.has(uploadedKey)).toBe(true)
  expect(env.DOCUMENTS.delete).toHaveBeenCalledExactlyOnceWith(oldKey)
  expect(sendSignedContractEmail).toHaveBeenCalledOnce()
  expect((await response.json()).stored).toMatchObject({ emailStatus: 'sent', sha256Hash: hash(newPdf) })
  const download = await downloadContract(context())
  expect(download.status).toBe(200)
  expect(await download.text()).toBe(newPdf)
  expect(receipts()).toEqual([])
})

it('records a deferred exact cleanup key before storage accepts any PDF bytes', async () => {
  env.DOCUMENTS.put.mockImplementation(async (key, bytes) => {
    const receipt = db.sql.prepare('SELECT storage_key, julianday(not_before)-julianday(created_at) AS days FROM storage_cleanup_intents').get()
    expect(receipt.storage_key).toBe(key)
    expect(receipt.days).toBeCloseTo(2, 4)
    expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ pending: 0, deleted: 0 })
    objects.set(key, new Uint8Array(bytes).slice())
  })
  expect((await storeContract(context())).status).toBe(201)
})

it('preserves the previous PDF when the room is archived during upload', async () => {
  seedStoredContract()
  env.DOCUMENTS.put.mockImplementation(async (key, bytes) => {
    const archived = await archiveRoom({ env, data: { user: company }, params: { roomId: 'room' },
      request: new Request('https://test.invalid/archive', { method: 'POST', body: '{}' }) })
    expect(archived.status).toBe(200)
    objects.set(key, new Uint8Array(bytes).slice())
  })
  const response = await storeContract(context())
  const uploadedKey = env.DOCUMENTS.put.mock.calls[0][0]
  expect(response.status).toBe(409)
  expect(db.sql.prepare('SELECT r2_key FROM signed_contracts').get().r2_key).toBe(oldKey)
  expect(objects.has(oldKey)).toBe(true)
  expect(objects.has(uploadedKey)).toBe(true)
  expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(sendSignedContractEmail).not.toHaveBeenCalled()
  expect(receipts()).toEqual([{ storage_key: uploadedKey }])
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ pending: 0, deleted: 0 })
  due()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ deleted: 1, failed: 0 })
  expect([...objects.keys()]).toEqual([oldKey])
})

it.each([
  ['the contract status changes', "UPDATE interview_rooms SET status = 'contract_pending'"],
  ['company participation is removed', "DELETE FROM room_participants WHERE user_id = 'company'"],
])('does not replace a PDF when %s during upload', async (_reason, change) => {
  seedStoredContract()
  env.DOCUMENTS.put.mockImplementation(async (key, bytes) => {
    db.sql.exec(change)
    objects.set(key, new Uint8Array(bytes).slice())
  })
  expect((await storeContract(context())).status).toBe(409)
  expect(db.sql.prepare('SELECT r2_key FROM signed_contracts').get().r2_key).toBe(oldKey)
  expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(sendSignedContractEmail).not.toHaveBeenCalled()
  expect(receipts()).toEqual([{ storage_key: env.DOCUMENTS.put.mock.calls[0][0] }])
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ pending: 0, deleted: 0 })
})

it('does not upload or send mail when a durable cleanup receipt cannot be acknowledged', async () => {
  const prepare = db.prepare.bind(db)
  vi.spyOn(db, 'prepare').mockImplementation(sql => {
    const statement = prepare(sql)
    if (/INSERT INTO storage_cleanup_intents/.test(sql)) statement.run = async () => { throw new Error('Synthetic receipt failure') }
    return statement
  })
  expect((await storeContract(context())).status).toBe(503)
  expect(env.DOCUMENTS.put).not.toHaveBeenCalled()
  expect(sendSignedContractEmail).not.toHaveBeenCalled()
})

it('cleans an upload accepted by storage after its PUT acknowledgement was lost', async () => {
  env.DOCUMENTS.put.mockImplementation(async (key, bytes) => {
    objects.set(key, new Uint8Array(bytes).slice())
    throw new Error('Synthetic lost PUT acknowledgement')
  })
  expect((await storeContract(context())).status).toBe(503)
  expect((await (await readContract(context())).json()).stored).toBeNull()
  expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(sendSignedContractEmail).not.toHaveBeenCalled()
  expect(receipts()).toHaveLength(1)
  due()
  expect((await runRetention(env, { dryRun: false })).storageCleanup).toMatchObject({ deleted: 1, failed: 0 })
  expect(objects.size).toBe(0)
  expect(receipts()).toEqual([])
})

it('rolls back the previous PDF cleanup receipt with a rejected replacement transaction', async () => {
  seedStoredContract()
  const batch = db.batch.bind(db)
  vi.spyOn(db, 'batch').mockImplementationOnce(async statements => {
    statements[3].source = 'INSERT INTO nonexistent_table VALUES (1)'
    return batch(statements)
  })
  expect((await storeContract(context())).status).toBe(503)
  expect(db.sql.prepare('SELECT r2_key FROM signed_contracts').get().r2_key).toBe(oldKey)
  expect(receipts()).toEqual([{ storage_key: env.DOCUMENTS.put.mock.calls[0][0] }])
  due()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ deleted: 1 })
  expect([...objects.keys()]).toEqual([oldKey])
})

it.each(['acknowledged', 'lost'])('retries old PDF cleanup after a %s save and a storage outage', async acknowledgement => {
  seedStoredContract()
  if (acknowledgement === 'lost') uncertainWrite({ committed: true })
  env.DOCUMENTS.delete.mockRejectedValueOnce(new Error('Synthetic storage outage'))
  const response = await storeContract(context())
  expect(response.status).toBe(acknowledgement === 'lost' ? 503 : 201)
  const newKey = env.DOCUMENTS.put.mock.calls[0][0]
  if (acknowledgement === 'lost') {
    expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
    due()
    expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ failed: 1, protected: 1 })
  }
  expect(objects.has(oldKey)).toBe(true)
  expect(receipts().some(receipt => receipt.storage_key === oldKey)).toBe(true)
  due()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ deleted: 1, failed: 0 })
  expect([...objects.keys()]).toEqual([newKey])
})

it('keeps a previous PDF used by the permanent archive during replacement cleanup', async () => {
  seedStoredContract()
  db.sql.prepare(`INSERT INTO contract_archive (id,room_id,terms_json,signatures_json,document_key,document_sha256,document_bytes)
    VALUES ('archive','room','{}','[]',?,'synthetic',10)`).run(oldKey)
  expect((await storeContract(context())).status).toBe(201)
  expect(objects.has(oldKey)).toBe(true)
  expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(receipts()).toEqual([{ storage_key: oldKey }])
})

it('captures the actual preceding key when two replacements prepare uploads before either saves', async () => {
  seedStoredContract()
  const puts = new Map()
  env.DOCUMENTS.put.mockImplementation((key, bytes) => new Promise(resolve => {
    puts.set(new TextDecoder().decode(bytes), () => { objects.set(key, new Uint8Array(bytes).slice()); resolve() })
  }))
  const first = storeContract(context())
  const secondPdf = '%PDF-1.7\nsecond replacement\n%%EOF'
  const second = storeContract(context(secondPdf))
  for (let count = 0; count < 50 && puts.size < 2; count++) await new Promise(resolve => setImmediate(resolve))
  expect(puts.size).toBe(2)
  puts.get(newPdf)()
  expect((await first).status).toBe(201)
  puts.get(secondPdf)()
  expect((await second).status).toBe(201)
  const download = await downloadContract(context())
  expect(await download.text()).toBe(secondPdf)
  expect(objects.size).toBe(1)
  expect(receipts()).toEqual([])
})
