import { describe, expect, it, vi } from 'vitest'
import { assertSmokeMethod, smokePolicy, verifySmokeIsolation } from '../scripts/smoke-policy.mjs'

const local = { SMOKE_URL: 'http://127.0.0.1:5189', SMOKE_API_URL: 'http://127.0.0.1:5189/api', SMOKE_ALLOW_WRITES: '1' }
const healthResponse = (changes = {}, headers = { 'X-Portfolio-Environment': 'local' }) => new Response(JSON.stringify({
  environment: 'local', externalRequests: false, emailDelivery: 'local-mailbox-only', ...changes,
}), { headers })

describe('smoke isolation policy', () => {
  it('uses production only for read-only requests by default', async () => {
    const policy = smokePolicy({})
    expect(policy.allowWrites).toBe(false)
    expect(policy.base).toBe('https://portfolio-epa.pages.dev')
    assertSmokeMethod(policy)
    assertSmokeMethod(policy, 'HEAD')
    const fetcher = vi.fn()
    await verifySmokeIsolation(policy, fetcher)
    expect(fetcher).not.toHaveBeenCalled()
    for (const method of ['post', 'PUT', 'PATCH', 'DELETE']) expect(() => assertSmokeMethod(policy, method)).toThrow('disabled')
  })

  it.each([
    {}, { SMOKE_URL: local.SMOKE_URL }, { SMOKE_API_URL: local.SMOKE_API_URL },
    { ...local, SMOKE_URL: 'https://portfolio-epa.pages.dev' },
    { ...local, SMOKE_API_URL: 'https://obumqkwkvnemkyaahjbn.supabase.co/functions/v1/api' },
    { ...local, SMOKE_API_URL: 'http://127.0.0.1:5173/api' },
    { ...local, SMOKE_URL: 'http://localhost:5189' },
    { ...local, SMOKE_API_URL: 'http://127.0.0.1:5189/api?redirect=remote' },
    { ...local, SMOKE_API_URL: 'http://user:password@127.0.0.1:5189/api' },
    { ...local, SMOKE_URL: 'http://127.0.0.1:5189/jobs' },
  ])('rejects unsafe or ambiguous writing configuration %# before HTTP', config => {
    expect(() => smokePolicy({ ...config, SMOKE_ALLOW_WRITES: '1' })).toThrow()
  })

  it('allows local writing only after the runtime proves isolation', async () => {
    const policy = smokePolicy(local)
    const fetcher = vi.fn().mockResolvedValue(healthResponse())
    await verifySmokeIsolation(policy, fetcher)
    expect(fetcher).toHaveBeenCalledWith(new URL('http://127.0.0.1:5189/__local/health'), { redirect: 'error' })
    assertSmokeMethod(policy, 'POST')
  })

  it.each([
    { environment: 'production' }, { externalRequests: true }, { emailDelivery: 'gmail' }, { externalRequests: undefined },
  ])('rejects a non-isolated health contract %#', async changes => {
    await expect(verifySmokeIsolation(smokePolicy(local), vi.fn().mockResolvedValue(healthResponse(changes)))).rejects.toThrow('blocked external')
  })

  it('rejects a runtime without the local response header', async () => {
    await expect(verifySmokeIsolation(smokePolicy(local), vi.fn().mockResolvedValue(healthResponse({}, {})))).rejects.toThrow('not the isolated')
  })
})
