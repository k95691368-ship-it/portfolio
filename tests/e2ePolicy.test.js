import { describe, expect, it, vi } from 'vitest'
import { e2ePolicy, e2eRequest, verifyE2eIsolation } from '../scripts/e2e-policy.mjs'

const local = { E2E_API_BASE: 'http://127.0.0.1:5189/api', E2E_ALLOW_WRITES: '1', E2E_ENVIRONMENT: 'test' }
const healthResponse = (changes = {}, headers = { 'X-Portfolio-Environment': 'local' }, status = 200) => new Response(JSON.stringify({
  environment: 'local', externalRequests: false, emailDelivery: 'local-mailbox-only', ...changes,
}), { headers, status })

describe('E2E isolation policy', () => {
  it.each([
    {}, { ...local, E2E_API_BASE: undefined }, { ...local, E2E_ALLOW_WRITES: undefined },
    { ...local, E2E_ENVIRONMENT: 'production' }, { ...local, E2E_ALLOW_WRITES: 'true' },
  ])('requires the explicit test target and write opt-in %#', config => {
    expect(() => e2ePolicy(config)).toThrow('are required')
  })

  it.each([
    'https://obumqkwkvnemkyaahjbn.supabase.co/functions/v1/api',
    'https://OBUMQKWKVNEMKYAAHJBN.supabase.co/functions/v1/api',
    'https://portfolio-epa.pages.dev/api',
    'https://PORTFOLIO-EPA.PAGES.DEV/api',
    'https://test.example.com/api',
    'http://localhost:5189/api',
    'http://127.0.0.2:5189/api',
    'http://2130706433:5189/api',
    'http://127.1:5189/api',
    'https://127.0.0.1:5189/api',
    'http://user:password@127.0.0.1:5189/api',
    'http://127.0.0.1:5189/api?redirect=remote',
    'http://127.0.0.1:5189/api#remote',
    'http://127.0.0.1:5189/functions/v1/api',
    'http://127.0.0.1:5189/other/../api',
  ])('rejects unsafe or ambiguous targets before HTTP: %s', base => {
    expect(() => e2ePolicy({ ...local, E2E_API_BASE: base })).toThrow('127.0.0.1')
  })

  it('preserves the explicit local /api target, including a trailing slash', () => {
    for (const base of [local.E2E_API_BASE, `${local.E2E_API_BASE}/`]) {
      expect(e2ePolicy({ ...local, E2E_API_BASE: base })).toEqual({
        base: 'http://127.0.0.1:5189', apiBase: local.E2E_API_BASE, allowWrites: true,
      })
    }
  })

  it('requires the runtime to prove blocked external traffic and local-only mail before login', async () => {
    const fetcher = vi.fn().mockResolvedValue(healthResponse())
    await verifyE2eIsolation(e2ePolicy(local), fetcher)
    expect(fetcher).toHaveBeenCalledWith(new URL('http://127.0.0.1:5189/__local/health'), { redirect: 'error' })
  })

  it.each([
    { environment: 'production' }, { externalRequests: true }, { emailDelivery: 'gmail' },
    { externalRequests: undefined }, { emailDelivery: undefined },
  ])('rejects a non-isolated health contract %#', async changes => {
    await expect(verifyE2eIsolation(e2ePolicy(local), vi.fn().mockResolvedValue(healthResponse(changes)))).rejects.toThrow('blocked external')
  })

  it.each([
    healthResponse({}, {}), healthResponse({}, { 'X-Portfolio-Environment': 'production' }), healthResponse({}, undefined, 503),
  ])('rejects an unverified runtime %#', async response => {
    await expect(verifyE2eIsolation(e2ePolicy(local), vi.fn().mockResolvedValue(response))).rejects.toThrow('not the isolated')
  })

  it('rejects a redirected health check before credentials or writes are sent', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('redirect prohibited'))
    await expect(verifyE2eIsolation(e2ePolicy(local), fetcher)).rejects.toThrow('redirect prohibited')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps credentials, body and method on the local API and prohibits redirects', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
    const options = { method: 'POST', headers: { 'X-App-Authorization': 'Bearer isolated-test-token' }, body: '{}', redirect: 'follow' }
    await e2eRequest(e2ePolicy(local), '/api/rooms/local-test/close', options, fetcher)
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:5189/api/rooms/local-test/close', { ...options, redirect: 'error' })
  })

  it('does not send a request for a non-API path', () => {
    const fetcher = vi.fn()
    expect(() => e2eRequest(e2ePolicy(local), 'https://test.example.com/api', {}, fetcher)).toThrow('/api path')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
