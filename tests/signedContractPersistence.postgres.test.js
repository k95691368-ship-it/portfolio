import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

vi.mock('npm:postgres@3.4.7', () => ({ default: () => { throw new Error('Live database access prohibited') } }))
vi.mock('../server/_lib/email.js', async original => ({
  ...await original(),
  isEmailConfigured: () => true,
  sendSignedContractEmail: vi.fn(async () => ({ id: 'synthetic-mail' })),
}))
import { PostgresD1 } from '../supabase/functions/api/postgresD1.ts'
import { sendSignedContractEmail } from '../server/_lib/email.js'
import { onRequestPost as storeContract, onRequestGet as readContract } from '../server/api/rooms/[roomId]/signed-contract.js'
import { onRequestGet as downloadContract } from '../server/api/rooms/[roomId]/signed-contract-file.js'
import { onRequestPost as archiveRoom } from '../server/api/rooms/[roomId]/archive.js'
import { runRetention } from '../server/_lib/retention.js'
import { processStorageCleanup } from '../server/_lib/storageCleanup.js'

let pg, db, saveOutcome, objects, env
const company = { id: 'company', role: 'company', display_name: 'Synthetic company' }
const oldKey = 'contracts/room/previous.pdf'
const oldPdf = '%PDF-1.7\nprevious\n%%EOF'
const newPdf = '%PDF-1.7\nreplacement\n%%EOF'

function adapter(client) {
  return {
    async unsafe(query, values = []) {
      if (saveOutcome === 'rollback' && /INSERT INTO signed_contracts\b/i.test(query)) throw new Error('Synthetic PostgreSQL failure')
      const result = await client.query(query, values)
      return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length })
    },
    async begin(operation) {
      let saving = false
      const value = await client.transaction(async transaction => {
        const wrapped = adapter(transaction), unsafe = wrapped.unsafe
        wrapped.unsafe = (query, values) => {
          saving ||= /INSERT INTO signed_contracts\b/i.test(query)
          return unsafe(query, values)
        }
        return operation(wrapped)
      })
      if (saving && saveOutcome === 'lost') throw new Error('Synthetic lost PostgreSQL commit acknowledgement')
      return value
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
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('External access prohibited') })
  await pg.exec(`TRUNCATE users CASCADE; TRUNCATE storage_cleanup_intents, contract_archive;
    INSERT INTO users (id,email,password_hash,password_salt,role,display_name) VALUES
      ('company','company@example.invalid','unused','unused','company','Synthetic company'),
      ('candidate','candidate@example.invalid','unused','unused','candidate','Synthetic candidate');
    INSERT INTO interview_rooms (id,company_user_id,title,status,invite_code) VALUES ('room','company','Synthetic','signed','REVIEWCODE12');
    INSERT INTO room_participants (room_id,user_id,role_in_room) VALUES ('room','company','company'),('room','candidate','candidate');
    INSERT INTO signed_contracts (id,room_id,r2_key,filename,size_bytes,stored_by_user_id,email_status)
      VALUES ('stored','room','${oldKey}','previous.pdf',10,'company','sent');`)
  objects = new Map([[oldKey, new TextEncoder().encode(oldPdf)]])
  env = { DB: db, DOCUMENTS: {
    put: vi.fn(async (key, bytes) => {
      const receipt = (await pg.query('SELECT storage_key, julianday(not_before)-julianday(created_at) AS days FROM storage_cleanup_intents WHERE storage_key = $1', [key])).rows[0]
      expect(receipt.storage_key).toBe(key)
      expect(receipt.days).toBeCloseTo(2, 4)
      objects.set(key, new Uint8Array(bytes).slice())
    }),
    get: vi.fn(async key => objects.has(key) ? { body: objects.get(key) } : null),
    delete: vi.fn(async key => { objects.delete(key) }),
  } }
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => { await pg?.close() })

function context() {
  const form = new FormData()
  form.append('pdf', new Blob([newPdf], { type: 'application/pdf' }), 'synthetic.pdf')
  return { env, data: { user: company }, params: { roomId: 'room' },
    request: new Request('https://test.invalid/signed-contract', { method: 'POST', body: form }) }
}
const receipts = async () => (await pg.query('SELECT storage_key FROM storage_cleanup_intents')).rows
const due = () => pg.exec("UPDATE storage_cleanup_intents SET not_before = datetime('now','-1 minute'), next_attempt_at = datetime('now','-1 minute')")

it.each(['acknowledged', 'rollback', 'lost'])('preserves the correct live PDF and cleans orphan keys after a PostgreSQL %s save', async outcome => {
  saveOutcome = outcome
  const response = await storeContract(context())
  const newKey = env.DOCUMENTS.put.mock.calls[0][0]
  expect(response.status).toBe(outcome === 'acknowledged' ? 201 : 503)
  expect(sendSignedContractEmail).toHaveBeenCalledTimes(outcome === 'acknowledged' ? 1 : 0)
  const stored = (await (await readContract(context())).json()).stored
  expect(stored.emailStatus).toBe(outcome === 'lost' ? 'not_sent' : 'sent')
  if (outcome !== 'acknowledged') {
    expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
    expect((await runRetention(env, { dryRun: false })).storageCleanup.deleted).toBe(0)
    expect(await receipts()).toHaveLength(outcome === 'lost' ? 2 : 1)
    await due()
    expect((await runRetention(env, { dryRun: false })).storageCleanup).toMatchObject({ deleted: 1, failed: 0 })
  }
  const liveKey = outcome === 'rollback' ? oldKey : newKey
  expect([...objects.keys()]).toEqual([liveKey])
  const download = await downloadContract(context())
  expect(await download.text()).toBe(outcome === 'rollback' ? oldPdf : newPdf)
})

it('keeps the previous PostgreSQL PDF cleanup receipt when storage fails and retries it', async () => {
  env.DOCUMENTS.delete.mockRejectedValueOnce(new Error('Synthetic storage outage'))
  expect((await storeContract(context())).status).toBe(201)
  expect(await receipts()).toEqual([{ storage_key: oldKey }])
  expect(objects.size).toBe(2)
  await due()
  expect((await runRetention(env, { dryRun: false })).storageCleanup).toMatchObject({ deleted: 1, failed: 0 })
  expect(objects.size).toBe(1)
  expect(await receipts()).toEqual([])
})

it('preserves the previous PostgreSQL PDF when the room is archived during upload', async () => {
  env.DOCUMENTS.put.mockImplementation(async (key, bytes) => {
    const archived = await archiveRoom({ env, data: { user: company }, params: { roomId: 'room' },
      request: new Request('https://test.invalid/archive', { method: 'POST', body: '{}' }) })
    expect(archived.status).toBe(200)
    objects.set(key, new Uint8Array(bytes).slice())
  })
  expect((await storeContract(context())).status).toBe(409)
  const uploadedKey = env.DOCUMENTS.put.mock.calls[0][0]
  expect((await pg.query('SELECT r2_key FROM signed_contracts')).rows[0].r2_key).toBe(oldKey)
  expect(objects.has(oldKey)).toBe(true)
  expect(objects.has(uploadedKey)).toBe(true)
  expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(sendSignedContractEmail).not.toHaveBeenCalled()
  expect(await receipts()).toEqual([{ storage_key: uploadedKey }])
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ pending: 0, deleted: 0 })
  await due()
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ deleted: 1, failed: 0 })
  expect([...objects.keys()]).toEqual([oldKey])
})

it.each([
  ['the contract status changes', "UPDATE interview_rooms SET status = 'contract_pending'"],
  ['company participation is removed', "DELETE FROM room_participants WHERE user_id = 'company'"],
])('does not replace a PostgreSQL PDF when %s during upload', async (_reason, change) => {
  env.DOCUMENTS.put.mockImplementation(async (key, bytes) => {
    await pg.exec(change)
    objects.set(key, new Uint8Array(bytes).slice())
  })
  expect((await storeContract(context())).status).toBe(409)
  expect((await pg.query('SELECT r2_key FROM signed_contracts')).rows[0].r2_key).toBe(oldKey)
  expect(env.DOCUMENTS.delete).not.toHaveBeenCalled()
  expect(sendSignedContractEmail).not.toHaveBeenCalled()
  expect(await receipts()).toEqual([{ storage_key: env.DOCUMENTS.put.mock.calls[0][0] }])
  expect(await processStorageCleanup(env, { dryRun: false })).toMatchObject({ pending: 0, deleted: 0 })
})
