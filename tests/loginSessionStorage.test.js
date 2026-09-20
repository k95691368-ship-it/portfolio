import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const KEY = 'portfolioSession'
const storage = () => {
  const rows = new Map()
  return {
    getItem: vi.fn((key) => rows.get(key) ?? null),
    setItem: vi.fn((key, value) => rows.set(key, String(value))),
    removeItem: vi.fn((key) => rows.delete(key)),
  }
}
const defer = () => {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const save = (target, token, expiresAt = new Date(Date.now() + 86400000).toISOString()) =>
  target.setItem(KEY, JSON.stringify({ token, expiresAt }))
const token = (target) => JSON.parse(target.getItem(KEY) || 'null')?.token || null
const login = (persistent = true, value = 'new-token') => Response.json({
  id: 'user', sessionToken: value, sessionPersistent: persistent,
  sessionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
})
const verifiedAccount = {
  id: 'verified-account', email: 'verified@example.test', role: 'candidate',
  displayName: 'Verified member', isAdmin: false, isRecruiter: false, isDeveloper: false,
  mustChangePassword: false, emailVerified: true,
}
const reload = async () => {
  vi.resetModules()
  return import('../src/api/client.js')
}
let api, getAccountSessionIdentity

beforeEach(async () => {
  vi.stubGlobal('localStorage', storage())
  vi.stubGlobal('sessionStorage', storage())
  vi.stubGlobal('fetch', vi.fn())
  ;({ api, getAccountSessionIdentity } = await reload())
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it.each([true, false])('stores a valid verified account in the remember=%s destination', async (persistent) => {
  const response = {
    ...verifiedAccount, sessionToken: 'verified-session', sessionPersistent: persistent,
    sessionExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  }
  fetch.mockResolvedValueOnce(Response.json(response))
  await expect(api.post('/account/verify-email', {})).resolves.toMatchObject(verifiedAccount)
  expect(token(localStorage)).toBe(persistent ? 'verified-session' : null)
  expect(token(sessionStorage)).toBe(persistent ? null : 'verified-session')
})

it.each([
  ['null', null], ['empty', {}],
  ['token without account', { sessionToken: 'unconfirmed-session' }],
  ['unverified account', { ...verifiedAccount, emailVerified: false, sessionToken: 'unconfirmed-session' }],
  ['invalid role', { ...verifiedAccount, role: 'administrator', sessionToken: 'unconfirmed-session' }],
  ['invalid permission', { ...verifiedAccount, isAdmin: 'false', sessionToken: 'unconfirmed-session' }],
])('rejects a %s response without replacing the stored account session', async (_label, response) => {
  save(localStorage, 'existing-session')
  localStorage.setItem.mockClear()
  fetch.mockResolvedValueOnce(Response.json(response))
  await expect(api.post('/account/verify-email', {})).rejects.toMatchObject({ code: 'INVALID_VERIFIED_ACCOUNT' })
  expect(token(localStorage)).toBe('existing-session')
  expect(token(sessionStorage)).toBeNull()
  expect(localStorage.setItem).not.toHaveBeenCalled()
  expect(sessionStorage.setItem).not.toHaveBeenCalled()
})

it.each(['headers', 'body'])('does not store a verified session after caller abort while waiting for %s', async (phase) => {
  save(localStorage, 'existing-session')
  const controller = new AbortController()
  const delayed = defer()
  const response = { ...verifiedAccount, sessionToken: 'verified-session', sessionPersistent: true }
  if (phase === 'headers') fetch.mockReturnValueOnce(delayed.promise)
  else fetch.mockResolvedValueOnce({ ok: true, headers: new Headers(), json: () => delayed.promise })
  const pending = api.post('/account/verify-email', {}, { signal: controller.signal }).catch((error) => error)
  await Promise.resolve()
  controller.abort()
  delayed.resolve(phase === 'headers' ? Response.json(response) : response)
  expect(await pending).toMatchObject({ name: 'AbortError' })
  expect(token(localStorage)).toBe('existing-session')
  expect(token(sessionStorage)).toBeNull()
})

it.each([true, false])('honors remember=%s on a same-tab reload and a simulated browser restart', async (persistent) => {
  fetch.mockResolvedValueOnce(login(persistent))
  await api.post('/login', { remember: persistent })
  expect(token(localStorage)).toBe(persistent ? 'new-token' : null)
  expect(token(sessionStorage)).toBe(persistent ? null : 'new-token')
  const sameTab = await reload()
  expect(sameTab.getAccountSessionIdentity()).toBe('new-token')
  vi.stubGlobal('sessionStorage', storage())
  const restarted = await reload()
  expect(restarted.getAccountSessionIdentity()).toBe(persistent ? 'new-token' : null)
  fetch.mockResolvedValueOnce(Response.json({ user: persistent ? { id: 'user' } : null }))
  await restarted.api.get('/me')
  expect(fetch.mock.lastCall[1].headers['X-App-Authorization']).toBe(persistent ? 'Bearer new-token' : undefined)
})

it.each(['getter', 'read'])('uses the available persistent store when sessionStorage %s throws', async (failure) => {
  save(localStorage, 'remembered')
  if (failure === 'getter') {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true, get() { throw new DOMException('private diagnostic', 'SecurityError') },
    })
  } else sessionStorage.getItem.mockImplementation(() => { throw new DOMException('private diagnostic', 'SecurityError') })
  expect(getAccountSessionIdentity()).toBe('remembered')
  fetch.mockResolvedValueOnce(Response.json({ user: { id: 'user' } }))
  await expect(api.get('/me')).resolves.toMatchObject({ user: { id: 'user' } })
  expect(fetch.mock.lastCall[1].headers['X-App-Authorization']).toBe('Bearer remembered')
})

it.each(['getter', 'read'])('uses sessionStorage when localStorage %s throws', async (failure) => {
  save(sessionStorage, 'tab-session')
  if (failure === 'getter') {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true, get() { throw new DOMException('private diagnostic', 'SecurityError') },
    })
  } else localStorage.getItem.mockImplementation(() => { throw new DOMException('private diagnostic', 'SecurityError') })
  expect(getAccountSessionIdentity()).toBe('tab-session')
  const renewed = new Date(Date.now() + 2 * 86400000).toISOString()
  fetch.mockResolvedValueOnce(Response.json({ user: { id: 'user' } }, { headers: { 'X-App-Session-Expires-At': renewed } }))
  await expect(api.get('/me')).resolves.toMatchObject({ user: { id: 'user' } })
  expect(JSON.parse(sessionStorage.getItem(KEY)).expiresAt).toBe(renewed)
})

it.each([true, false])('keeps the previous session if the remember=%s target cannot be written', async (persistent) => {
  const target = persistent ? localStorage : sessionStorage
  const previous = persistent ? sessionStorage : localStorage
  save(previous, 'previous-token')
  target.setItem.mockImplementation(() => { throw new DOMException('private diagnostic', 'QuotaExceededError') })
  fetch.mockResolvedValueOnce(login(persistent))
  await expect(api.post('/login', { remember: persistent })).rejects.toMatchObject({
    code: 'SESSION_STORAGE_WRITE_FAILED', message: expect.not.stringContaining('private diagnostic'),
  })
  expect(token(previous)).toBe('previous-token')
  expect(token(target)).toBeNull()
  expect(getAccountSessionIdentity()).toBe('previous-token')
})

it('does not silently downgrade persistent login when the localStorage getter is blocked', async () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, get() { throw new DOMException('private diagnostic', 'SecurityError') },
  })
  fetch.mockResolvedValueOnce(login(true))
  await expect(api.post('/login', { remember: true })).rejects.toMatchObject({ code: 'SESSION_STORAGE_WRITE_FAILED' })
  expect(token(sessionStorage)).toBeNull()
})

it.each(['getter', 'read'])('does not report login success while the previous store %s cannot be inspected', async (failure) => {
  const previous = sessionStorage
  save(previous, 'previous-token')
  if (failure === 'getter') {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true, get() { throw new DOMException('private diagnostic', 'SecurityError') },
    })
  } else previous.getItem.mockImplementation(() => { throw new DOMException('private diagnostic', 'SecurityError') })
  fetch.mockResolvedValueOnce(login(true))
  await expect(api.post('/login', {})).rejects.toMatchObject({ code: 'SESSION_STORAGE_WRITE_FAILED' })
  expect(token(localStorage)).toBeNull()
  expect(previous.removeItem).not.toHaveBeenCalled()
})

it('writes the new target before deleting the previous store', async () => {
  save(sessionStorage, 'previous-token')
  fetch.mockResolvedValueOnce(login(true))
  await api.post('/login', { remember: true })
  expect(token(localStorage)).toBe('new-token')
  expect(token(sessionStorage)).toBeNull()
  expect(localStorage.setItem.mock.invocationCallOrder[0]).toBeLessThan(sessionStorage.removeItem.mock.invocationCallOrder[0])
})

it('rolls back a new target when the previous session cannot be removed', async () => {
  save(sessionStorage, 'previous-token')
  sessionStorage.removeItem.mockImplementation(() => { throw new DOMException('private diagnostic', 'SecurityError') })
  fetch.mockResolvedValueOnce(login(true))
  await expect(api.post('/login', {})).rejects.toMatchObject({ code: 'SESSION_STORAGE_WRITE_FAILED' })
  expect(token(sessionStorage)).toBe('previous-token')
  expect(token(localStorage)).toBeNull()
})

it('does not clear a different shared account while installing a new tab-only login', async () => {
  save(sessionStorage, 'this-tab-old')
  save(localStorage, 'another-tab-account')
  fetch.mockResolvedValueOnce(login(false))
  await api.post('/login', { remember: false })
  expect(token(sessionStorage)).toBe('new-token')
  expect(token(localStorage)).toBe('another-tab-account')
})

it.each(['offline', '503', 'slow'])('ends the local login immediately when logout is %s', async (failure) => {
  save(localStorage, 'logout-token')
  const pending = defer()
  fetch.mockReturnValueOnce(pending.promise)
  const logout = api.post('/logout', {})
  expect(getAccountSessionIdentity()).toBeNull()
  expect(token(localStorage)).toBeNull()
  expect(fetch.mock.lastCall[1].headers['X-App-Authorization']).toBe('Bearer logout-token')
  if (failure === 'offline') pending.reject(new TypeError('Offline'))
  else pending.resolve(Response.json(failure === '503' ? { error: 'unavailable' } : { ok: true }, { status: failure === '503' ? 503 : 200 }))
  if (failure === 'slow') await expect(logout).resolves.toEqual({ ok: true })
  else await expect(logout).rejects.toBeInstanceOf(Error)
  expect(getAccountSessionIdentity()).toBeNull()
  expect((await reload()).getAccountSessionIdentity()).toBeNull()
})

it('clears matching logout tokens in both stores but preserves room identities', async () => {
  save(localStorage, 'same-token'); save(sessionStorage, 'same-token')
  localStorage.setItem('portfolioRoomSessions', JSON.stringify({ room: { token: 'room-token' } }))
  fetch.mockResolvedValueOnce(Response.json({ ok: true }))
  await api.post('/logout', {})
  expect(token(localStorage)).toBeNull()
  expect(token(sessionStorage)).toBeNull()
  expect(localStorage.getItem('portfolioRoomSessions')).toContain('room-token')
})

it.each([true, false])('clears the independent application inbox proof before logout finishes (account present: %s)', async (accountPresent) => {
  if (accountPresent) save(localStorage, 'logout-token')
  sessionStorage.setItem('portfolioApplicationAccess', JSON.stringify({ token: 'synthetic-inbox-proof' }))
  const response = defer()
  fetch.mockReturnValueOnce(response.promise)
  const completion = api.post('/logout', {}).catch((error) => error)
  expect(sessionStorage.getItem('portfolioApplicationAccess')).toBeNull()
  response.reject(new TypeError('Offline'))
  expect(await completion).toBeInstanceOf(Error)
  expect(sessionStorage.getItem('portfolioApplicationAccess')).toBeNull()
})

it('reports failed cleanup of the independent inbox proof while still revoking the account token', async () => {
  save(localStorage, 'logout-token')
  sessionStorage.setItem('portfolioApplicationAccess', JSON.stringify({ token: 'synthetic-inbox-proof' }))
  const remove = sessionStorage.removeItem.getMockImplementation()
  sessionStorage.removeItem.mockImplementation((key) => {
    if (key === 'portfolioApplicationAccess') throw new DOMException('Private detail', 'SecurityError')
    return remove(key)
  })
  fetch.mockResolvedValueOnce(Response.json({ ok: true }))
  await expect(api.post('/logout', {})).rejects.toMatchObject({ code: 'SESSION_STORAGE_CLEAR_FAILED' })
  expect(token(localStorage)).toBeNull()
  expect(fetch.mock.lastCall[1].headers['X-App-Authorization']).toBe('Bearer logout-token')
})

it('does not let an old tab logout delete another tab account in localStorage', async () => {
  save(sessionStorage, 'old-tab-token'); save(localStorage, 'other-tab-token')
  fetch.mockResolvedValueOnce(Response.json({ ok: true }))
  await api.post('/logout', {})
  expect(fetch.mock.lastCall[1].headers['X-App-Authorization']).toBe('Bearer old-tab-token')
  expect(token(sessionStorage)).toBeNull()
  expect(token(localStorage)).toBe('other-tab-token')
  expect(getAccountSessionIdentity()).toBeNull()
  fetch.mockResolvedValueOnce(Response.json({ user: null }))
  await api.get('/me')
  expect(fetch.mock.lastCall[1].headers['X-App-Authorization']).toBeUndefined()
  const reopenedTab = await reload()
  expect(reopenedTab.getAccountSessionIdentity()).toBeNull()
  fetch.mockResolvedValueOnce(Response.json({ user: null }))
  await reopenedTab.api.get('/me')
  expect(fetch.mock.lastCall[1].headers['X-App-Authorization']).toBeUndefined()
  // A genuinely new tab still has the other account's remembered login.
  vi.stubGlobal('sessionStorage', storage())
  expect((await reload()).getAccountSessionIdentity()).toBe('other-tab-token')
})

it.each([true, false])('allows an explicit remember=%s login after tab-only logout suppression', async (persistent) => {
  save(sessionStorage, 'old-tab-token'); save(localStorage, 'other-tab-token')
  fetch.mockResolvedValueOnce(Response.json({ ok: true }))
  await api.post('/logout', {})
  const sameTab = await reload()
  fetch.mockResolvedValueOnce(login(persistent, 'explicit-new-token'))
  await sameTab.api.post('/login', { remember: persistent })
  expect(sameTab.getAccountSessionIdentity()).toBe('explicit-new-token')
  expect((await reload()).getAccountSessionIdentity()).toBe('explicit-new-token')
  expect(token(localStorage)).toBe(persistent ? 'explicit-new-token' : 'other-tab-token')
})

it('keeps this tab signed out when another tab later installs a different persistent account', async () => {
  save(localStorage, 'first-token')
  fetch.mockResolvedValueOnce(Response.json({ ok: true }))
  await api.post('/logout', {})
  save(localStorage, 'another-tab-new-token')
  expect(getAccountSessionIdentity()).toBeNull()
  expect((await reload()).getAccountSessionIdentity()).toBeNull()
})

it('does not fall back to another account if the signed-out marker cannot be persisted', async () => {
  save(sessionStorage, 'old-tab-token'); save(localStorage, 'other-tab-token')
  sessionStorage.setItem.mockImplementation(() => { throw new DOMException('private diagnostic', 'QuotaExceededError') })
  fetch.mockResolvedValueOnce(Response.json({ ok: true }))
  await expect(api.post('/logout', {})).rejects.toMatchObject({ code: 'SESSION_STORAGE_CLEAR_FAILED' })
  expect(getAccountSessionIdentity()).toBeNull()
  expect(token(localStorage)).toBe('other-tab-token')
  expect(fetch.mock.lastCall[1].headers['X-App-Authorization']).toBe('Bearer old-tab-token')
  fetch.mockResolvedValueOnce(Response.json({ user: null }))
  await api.get('/me')
  expect(fetch.mock.lastCall[1].headers['X-App-Authorization']).toBeUndefined()
})

it('removes a hidden old session after failed logout before accepting a persistent login', async () => {
  save(sessionStorage, 'hidden-old-token'); save(localStorage, 'other-tab-token')
  sessionStorage.removeItem.mockImplementationOnce(() => { throw new DOMException('denied', 'SecurityError') })
  fetch.mockResolvedValueOnce(Response.json({ ok: true }))
  await expect(api.post('/logout', {})).rejects.toMatchObject({ code: 'SESSION_STORAGE_CLEAR_FAILED' })
  expect(token(sessionStorage)).toBe('hidden-old-token')
  expect(getAccountSessionIdentity()).toBeNull()
  fetch.mockResolvedValueOnce(login(true, 'explicit-new-token'))
  await api.post('/login', { remember: true })
  expect(token(sessionStorage)).toBeNull()
  expect(getAccountSessionIdentity()).toBe('explicit-new-token')
})

it('rolls back login if its signed-out marker cannot be cleared', async () => {
  save(localStorage, 'old-token')
  fetch.mockResolvedValueOnce(Response.json({ ok: true }))
  await api.post('/logout', {})
  sessionStorage.removeItem.mockImplementation(() => { throw new DOMException('private diagnostic', 'SecurityError') })
  fetch.mockResolvedValueOnce(login(true))
  await expect(api.post('/login', {})).rejects.toMatchObject({ code: 'SESSION_STORAGE_WRITE_FAILED' })
  expect(token(localStorage)).toBeNull()
  expect(getAccountSessionIdentity()).toBeNull()
  expect((await reload()).getAccountSessionIdentity()).toBeNull()
})

it.each(['success', 'network_failure'])('never clears a newer login after a late logout %s', async (outcome) => {
  save(localStorage, 'old-token')
  const pending = defer()
  fetch.mockReturnValueOnce(pending.promise)
  const logout = api.post('/logout', {})
  fetch.mockResolvedValueOnce(login(true, 'newer-token'))
  await api.post('/login', {})
  if (outcome === 'success') pending.resolve(Response.json({ ok: true }))
  else pending.reject(new TypeError('Offline'))
  await expect(logout).rejects.toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
  expect(getAccountSessionIdentity()).toBe('newer-token')
})

it.each([false, true])('bounds a stalled logout to ten seconds (new login while pending: %s)', async (newLogin) => {
  vi.useFakeTimers()
  save(localStorage, 'old-token')
  fetch.mockReturnValueOnce(new Promise(() => {}))
  const logout = api.post('/logout', {})
  const result = Promise.allSettled([logout])
  expect(getAccountSessionIdentity()).toBeNull()
  if (newLogin) {
    fetch.mockResolvedValueOnce(login(true, 'new-token'))
    await api.post('/login', {})
  }
  await vi.advanceTimersByTimeAsync(9999)
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect((await result)[0].reason.code).toBe(newLogin ? 'STALE_AUTH_RESPONSE' : 'REQUEST_TIMEOUT')
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
  expect(getAccountSessionIdentity()).toBe(newLogin ? 'new-token' : null)
})

it('attempts remote logout even if local token deletion fails and reports a sanitized storage error', async () => {
  save(localStorage, 'logout-token')
  localStorage.removeItem.mockImplementation(() => { throw new DOMException('private diagnostic', 'SecurityError') })
  fetch.mockResolvedValueOnce(Response.json({ ok: true }))
  await expect(api.post('/logout', {})).rejects.toMatchObject({
    code: 'SESSION_STORAGE_CLEAR_FAILED', message: expect.not.stringContaining('private diagnostic'),
  })
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch.mock.lastCall[1].headers['X-App-Authorization']).toBe('Bearer logout-token')
})

it('reports failed local clearing if the captured token store becomes unreadable before deletion', async () => {
  save(localStorage, 'logout-token')
  const saved = localStorage.getItem(KEY)
  localStorage.getItem.mockReset().mockReturnValueOnce(saved)
    .mockImplementation(() => { throw new DOMException('private diagnostic', 'SecurityError') })
  fetch.mockResolvedValueOnce(Response.json({ ok: true }))
  await expect(api.post('/logout', {})).rejects.toMatchObject({ code: 'SESSION_STORAGE_CLEAR_FAILED' })
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch.mock.lastCall[1].headers['X-App-Authorization']).toBe('Bearer logout-token')
})

it.each(['no_user', '401'])('clears only the request token when /me confirms %s', async (outcome) => {
  save(sessionStorage, 'invalid-token'); save(localStorage, 'other-tab-token')
  fetch.mockResolvedValueOnce(Response.json(outcome === '401' ? { error: 'Unauthorized' } : { user: null }, {
    status: outcome === '401' ? 401 : 200,
  }))
  if (outcome === '401') await expect(api.get('/me')).rejects.toMatchObject({ status: 401 })
  else await expect(api.get('/me')).resolves.toEqual({ user: null })
  expect(token(sessionStorage)).toBeNull()
  expect(token(localStorage)).toBe('other-tab-token')
})

it.each(['offline', '503'])('retains remembered credentials for a temporary /me %s', async (failure) => {
  save(localStorage, 'persistent-token')
  if (failure === 'offline') fetch.mockRejectedValueOnce(new TypeError('Offline'))
  else fetch.mockResolvedValueOnce(Response.json({ error: 'unavailable' }, { status: 503 }))
  await expect(api.get('/me')).rejects.toBeInstanceOf(Error)
  expect(getAccountSessionIdentity()).toBe('persistent-token')
})

it('does not clear a new account when a previous /me response confirms logout late', async () => {
  save(localStorage, 'old-token')
  const pending = defer()
  fetch.mockReturnValueOnce(pending.promise)
  const lookup = api.get('/me')
  save(localStorage, 'new-token')
  pending.resolve(Response.json({ user: null }))
  await expect(lookup).rejects.toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
  expect(getAccountSessionIdentity()).toBe('new-token')
})

it('preserves legacy token-only values and persists server renewal through client restart', async () => {
  localStorage.setItem(KEY, JSON.stringify({ token: 'legacy-token' }))
  expect(getAccountSessionIdentity()).toBe('legacy-token')
  const renewed = new Date(Date.now() + 30 * 86400000).toISOString()
  fetch.mockResolvedValueOnce(Response.json({ user: { id: 'user' } }, { headers: { 'X-App-Session-Expires-At': renewed } }))
  await api.get('/me')
  expect(JSON.parse(localStorage.getItem(KEY)).expiresAt).toBe(renewed)
  expect((await reload()).getAccountSessionIdentity()).toBe('legacy-token')
})
