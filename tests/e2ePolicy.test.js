import { describe, expect, it, vi } from 'vitest'
import { e2ePolicy, e2eRequest, verifyE2eIsolation } from '../scripts/e2e-policy.mjs'
import * as e2e from '../scripts/e2e-policy.mjs'

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

describe('local verification link lookup', () => {
  const token = 'A'.repeat(43)
  const email = 'synthetic@example.invalid'
  const mailResponse = (href, recipient = email, headers = { 'X-Portfolio-Environment': 'local' }, status = 200) =>
    new Response(`<article><p>수신: ${recipient} · 2026-10-04</p><pre><a href="${href}">확인</a></pre></article>`, { headers, status })
  const href = `http://127.0.0.1:5189/verify-email#token=${token}`
  const mailbox = response => vi.fn().mockResolvedValueOnce(healthResponse()).mockResolvedValueOnce(response)

  it('reads only the selected synthetic recipient after isolated health, without following links', async () => {
    const fetcher = mailbox(mailResponse(href))
    expect(await e2e.readE2eVerificationToken(e2ePolicy(local), email, fetcher)).toBe(token)
    expect(fetcher.mock.calls).toEqual([
      [new URL('http://127.0.0.1:5189/__local/health'), { redirect: 'error' }],
      [new URL('http://127.0.0.1:5189/__local/mail'), { redirect: 'error' }],
    ])
  })

  it.each([
    `https://portfolio-epa.pages.dev/verify-email#token=${token}`,
    `http://127.0.0.1:5190/verify-email#token=${token}`,
    `http://localhost:5189/verify-email#token=${token}`,
    `http://user:secret@127.0.0.1:5189/verify-email#token=${token}`,
    `http://127.0.0.1:5189/reset-password#token=${token}`,
    `http://127.0.0.1:5189/verify-email?token=${token}`,
    `http://127.0.0.1:5189/verify-email#token=${token}&extra=1`,
    'http://127.0.0.1:5189/verify-email#token=invalid',
  ])('refuses unsafe or unrelated links without contacting them %#', async link => {
    const fetcher = mailbox(mailResponse(link))
    await expect(e2e.readE2eVerificationToken(e2ePolicy(local), email, fetcher)).rejects.toThrow('verification link')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each(['real@example.com', '<img>@example.invalid', 'OTHER@EXAMPLE.INVALID'])('rejects non-synthetic or non-canonical recipients before reading mail %#', async recipient => {
    const fetcher = vi.fn()
    await expect(e2e.readE2eVerificationToken(e2ePolicy(local), recipient, fetcher)).rejects.toThrow('synthetic recipient')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('never opens the mailbox when isolation health is invalid', async () => {
    const fetcher = vi.fn().mockResolvedValue(healthResponse({ externalRequests: true }))
    await expect(e2e.readE2eVerificationToken(e2ePolicy(local), email, fetcher)).rejects.toThrow('blocked external')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    { ...e2ePolicy(local), base: 'https://portfolio-epa.pages.dev' },
    { ...e2ePolicy(local), apiBase: 'https://portfolio-epa.pages.dev/api' },
    { ...e2ePolicy(local), allowWrites: false },
  ])('rejects a forged mailbox policy before HTTP %#', async policy => {
    const fetcher = vi.fn()
    await expect(e2e.readE2eVerificationToken(policy, email, fetcher)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    mailResponse(href, 'another@example.invalid'), mailResponse(href, email, {}),
    mailResponse(href, email, undefined, 503),
    new Response(`<article><p>수신: ${email} · now</p><a href="${href}">one</a><a href="${href}">two</a></article>`, { headers: { 'X-Portfolio-Environment': 'local' } }),
    new Response(`<article><p>수신: ${email} · now</p><a href="${href}">one</a></article><article><p>수신: ${email} · now</p><a href="${href}">two</a></article>`, { headers: { 'X-Portfolio-Environment': 'local' } }),
  ])('rejects missing, unverified or ambiguous mail without exposing its content %#', async response => {
    await expect(e2e.readE2eVerificationToken(e2ePolicy(local), email, mailbox(response))).rejects.toThrow(/local mailbox|verification link/)
  })
})
