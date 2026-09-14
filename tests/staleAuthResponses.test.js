import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const storage = () => { const rows = new Map(); return { getItem: (k) => rows.get(k) || null, setItem: (k, v) => rows.set(k, v), removeItem: (k) => rows.delete(k) } }
const defer = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const respond = (body) => Response.json(body)
const setAccount = (token) => localStorage.setItem('portfolioSession', JSON.stringify({ token }))
let api, apiBlob
beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage()); vi.stubGlobal('fetch', vi.fn())
  ;({ api, apiBlob } = await import('../src/api/client.js'))
})
afterEach(() => vi.unstubAllGlobals())

it.each(['get', 'post', 'upload', 'blob'])('discards an old account response on %s after an account switch', async (method) => {
  setAccount('old')
  const pending = defer(); fetch.mockReturnValueOnce(pending.promise)
  const result = method === 'blob' ? apiBlob('/documents/file') : method === 'upload' ? api.upload('/documents/upload', new FormData()) : api[method]('/me', {})
  setAccount('new')
  pending.resolve(respond({ privateData: 'old account data' }))
  await expect(result).rejects.toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
})

it('does not let a late logout clear the newly logged-in account', async () => {
  setAccount('old')
  const pending = defer(); fetch.mockReturnValueOnce(pending.promise)
  const result = api.post('/logout', {})
  setAccount('new'); pending.resolve(respond({ ok: true }))
  await expect(result).rejects.toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
  expect(JSON.parse(localStorage.getItem('portfolioSession')).token).toBe('new')
})

it('does not let a late password-change response replace the current account', async () => {
  setAccount('old')
  const pending = defer(); fetch.mockReturnValueOnce(pending.promise)
  const result = api.post('/change-password', {})
  setAccount('new'); pending.resolve(respond({ ok: true, sessionToken: 'rotated-old' }))
  await expect(result).rejects.toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
  expect(JSON.parse(localStorage.getItem('portfolioSession')).token).toBe('new')
})

it('rejects a room response when switching between company and candidate identities', async () => {
  localStorage.setItem('roomDoor', JSON.stringify({ roomId: 'one', door: 'account' }))
  const pending = defer(); fetch.mockReturnValueOnce(pending.promise)
  const result = api.get('/rooms/one/view')
  localStorage.setItem('roomDoor', JSON.stringify({ roomId: 'one', door: 'code' }))
  pending.resolve(respond({ privateData: 'company' }))
  await expect(result).rejects.toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
})

it('checks identity again after downloading the response body', async () => {
  setAccount('old')
  const body = defer(); fetch.mockResolvedValueOnce({ ok: true, headers: new Headers(), json: () => body.promise })
  const result = api.get('/me')
  await Promise.resolve()
  setAccount('new'); body.resolve({ user: 'old' })
  await expect(result).rejects.toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
})

it('still accepts intentional login, password renewal and logout responses', async () => {
  fetch.mockResolvedValueOnce(respond({ sessionToken: 'login-token', sessionPersistent: false }))
  await api.post('/login', {})
  expect(JSON.parse(sessionStorage.getItem('portfolioSession')).token).toBe('login-token')
  fetch.mockResolvedValueOnce(respond({ sessionToken: 'changed-token', sessionPersistent: false }))
  await api.post('/change-password', {})
  expect(JSON.parse(sessionStorage.getItem('portfolioSession')).token).toBe('changed-token')
  fetch.mockResolvedValueOnce(respond({ ok: true }))
  await api.post('/logout', {})
  expect(sessionStorage.getItem('portfolioSession')).toBeNull()
})

it('allows only the latest login attempt to update the account', async () => {
  const earlier = defer(); const later = defer()
  fetch.mockReturnValueOnce(earlier.promise).mockReturnValueOnce(later.promise)
  const first = api.post('/login', {}); const second = api.post('/login', {})
  earlier.resolve(respond({ sessionToken: 'earlier' }))
  await expect(first).rejects.toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
  later.resolve(respond({ sessionToken: 'later' }))
  await second
  expect(JSON.parse(localStorage.getItem('portfolioSession')).token).toBe('later')
})

it('does not treat token-shaped fields in a normal API response as authentication', async () => {
  setAccount('current')
  fetch.mockResolvedValueOnce(respond({ sessionToken: 'unexpected', roomId: 'room', roomSessionToken: 'unexpected-room' }))
  await api.get('/me')
  expect(JSON.parse(localStorage.getItem('portfolioSession')).token).toBe('current')
  expect(localStorage.getItem('portfolioRoomSessions')).toBeNull()
})
