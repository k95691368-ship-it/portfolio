import { afterEach, expect, it, vi } from 'vitest'
vi.mock('../server/_lib/storageCleanup.js', () => ({ processStorageCleanup: vi.fn() }))
vi.mock('../supabase/functions/api/postgresD1.ts', () => ({ createPostgresD1: vi.fn(() => ({ fixture: 'database' })) }))
vi.mock('../supabase/functions/api/supabaseStorage.ts', () => ({ createSupabaseStorage: vi.fn((_env, bucket) => ({ fixture: bucket })) }))
import { processStorageCleanup } from '../server/_lib/storageCleanup.js'
import { handleStorageCleanupJob } from '../server/_lib/storageCleanupJob.js'

const secret = 'fixture-only-storage-cleanup-credential'
const report = { pending: 2, deleted: 1, failed: 0, protected: 1 }
const environment = (extra = {}) => ({ STORAGE_CLEANUP_JOB_SECRET: secret, ...extra })
const request = (body = { dryRun: false }, { headers, ...options } = {}) => new Request('https://fixture.invalid/storage-cleanup', {
  method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body), ...options,
})
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

it.each([undefined, '', 'wrong', `Bearer ${secret} extra`, 'Bearer application-session'])('rejects authorization %j before reading the body or queue', async authorization => {
  const response = await handleStorageCleanupJob(request(undefined, { headers: { Authorization: authorization || '' } }), environment())
  expect(response.status).toBe(403)
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(processStorageCleanup).not.toHaveBeenCalled()
})

it.each([undefined, '', ' ', `${secret} `])('fails closed with an unconfigured or malformed job secret %j', async configured => {
  expect((await handleStorageCleanupJob(request(), environment({ STORAGE_CLEANUP_JOB_SECRET: configured }))).status).toBe(403)
  expect(processStorageCleanup).not.toHaveBeenCalled()
})

it('requires POST without enabling browser preflight or alternate methods', async () => {
  for (const method of ['GET', 'OPTIONS', 'PUT', 'DELETE']) {
    const response = await handleStorageCleanupJob(new Request('https://fixture.invalid/storage-cleanup', {
      method, headers: { Authorization: `Bearer ${secret}` },
    }), environment())
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    expect(response.headers.get('Cache-Control')).toContain('no-store')
  }
  expect(processStorageCleanup).not.toHaveBeenCalled()
})

it.each([null, [], {}, { dryRun: 'false' }, { dryRun: 0 }, { dryRun: null }, { dryRun: false, limit: 1000 }, { dryRun: false, operationId: 'fixture' }])('rejects malformed controls %j', async body => {
  expect((await handleStorageCleanupJob(request(body), environment())).status).toBe(400)
  expect(processStorageCleanup).not.toHaveBeenCalled()
})

it('rejects non-JSON, damaged JSON and declared oversized bodies', async () => {
  expect((await handleStorageCleanupJob(request(undefined, { headers: { 'Content-Type': 'text/plain' } }), environment())).status).toBe(415)
  expect((await handleStorageCleanupJob(request(undefined, { body: '{bad json' }), environment())).status).toBe(400)
  expect((await handleStorageCleanupJob(request(undefined, { headers: { 'Content-Length': String(256 * 1024 + 1) } }), environment())).status).toBe(413)
  expect(processStorageCleanup).not.toHaveBeenCalled()
})

it.each([undefined, '', '0', 'true', 1, true])('keeps execution disabled for setting %j', async setting => {
  processStorageCleanup.mockResolvedValueOnce(report)
  const env = environment({ STORAGE_CLEANUP_EXECUTE: setting, RETENTION_EXECUTE: '1', RETENTION_JOB_SECRET: 'fixture-retention' })
  const response = await handleStorageCleanupJob(request(), env)
  expect(await response.json()).toEqual({ dryRun: true, ...report })
  expect(processStorageCleanup).toHaveBeenCalledExactlyOnceWith(env, { dryRun: true, limit: 25 })
})

it.each([true, false])('honors dryRun=%s only after the independent execution gate is enabled', async dryRun => {
  processStorageCleanup.mockResolvedValueOnce(report)
  const env = environment({ STORAGE_CLEANUP_EXECUTE: '1' })
  const response = await handleStorageCleanupJob(request({ dryRun }), env)
  expect(await response.json()).toEqual({ dryRun, ...report })
  expect(processStorageCleanup).toHaveBeenCalledExactlyOnceWith(env, { dryRun, limit: 25 })
  expect(response.headers.get('Cache-Control')).toContain('no-store')
})

it('returns safe failure diagnostics without a provider path or credential', async () => {
  processStorageCleanup.mockRejectedValueOnce(new Error(`private-fixture-path ${secret}`))
  const response = await handleStorageCleanupJob(request(), environment({ STORAGE_CLEANUP_EXECUTE: '1' }))
  expect(response.status).toBe(503)
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(await response.text()).toBe('{"error":"Storage cleanup job could not be completed."}')
})

it('wires the Edge entrypoint to the same guarded queue-only handler', async () => {
  let edgeHandler
  const env = environment({ STORAGE_CLEANUP_EXECUTE: '1', SUPABASE_DB_URL: 'fixture-unused' })
  vi.stubGlobal('Deno', { env: { toObject: () => env }, serve: handler => { edgeHandler = handler } })
  await import('../supabase/functions/storage-cleanup/index.ts')
  processStorageCleanup.mockResolvedValueOnce(report)
  expect(await (await edgeHandler(request({ dryRun: true }))).json()).toEqual({ dryRun: true, ...report })
  expect(processStorageCleanup).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    STORAGE_CLEANUP_JOB_SECRET: secret, DB: { fixture: 'database' }, DOCUMENTS: { fixture: 'documents' },
    INTERVIEW_RECORDINGS: { fixture: 'interview-recordings' },
  }), { dryRun: true, limit: 25 })
})
