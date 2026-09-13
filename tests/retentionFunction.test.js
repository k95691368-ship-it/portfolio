import { afterEach, it, expect, vi } from 'vitest'
vi.mock('../supabase/functions/api/postgresD1.ts', () => ({ createPostgresD1: () => ({}) }))
vi.mock('../supabase/functions/api/supabaseStorage.ts', () => ({ createSupabaseStorage: () => ({}) }))
vi.mock('../server/_lib/retention.js', () => ({ runRetention: vi.fn(async (_env, options) => options) }))
import { runRetention } from '../server/_lib/retention.js'
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('requires its own credential and cannot delete unless both execution gates are enabled', async () => {
  let handler
  const environment = { RETENTION_JOB_SECRET: 'test-only-schedule-credential' }
  vi.stubGlobal('Deno', { env: { toObject: () => environment }, serve: (fn) => { handler = fn } })
  await import('../supabase/functions/retention/index.ts')
  const request = (body, authorized = true) => new Request('https://test.invalid/retention', {
    method: 'POST', headers: authorized ? { Authorization: `Bearer ${environment.RETENTION_JOB_SECRET}` } : {}, body: JSON.stringify(body),
  })
  expect((await handler(request({ dryRun: false }, false))).status).toBe(403)
  expect((await handler(request({}))).status).toBe(400)
  expect(runRetention).not.toHaveBeenCalled()
  expect(await (await handler(request({ dryRun: false }))).json()).toEqual({ dryRun: true })
  environment.RETENTION_EXECUTE = '1'
  expect(await (await handler(request({ dryRun: true }))).json()).toEqual({ dryRun: true })
  expect(await (await handler(request({ dryRun: false }))).json()).toEqual({ dryRun: false })
})
