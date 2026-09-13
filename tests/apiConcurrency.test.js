import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})

describe('진행 중인 API 조회 공유', () => {
  let api
  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('sessionStorage', memoryStorage())
    vi.stubGlobal('fetch', vi.fn())
    api = (await import('../src/api/client.js')).api
  })
  afterEach(() => vi.unstubAllGlobals())

  it('persists the server expiry only for the account that sent the request', async () => {
    const original = new Date(Date.now() + 86400000).toISOString()
    const renewed = new Date(Date.now() + 30 * 86400000).toISOString()
    sessionStorage.setItem('portfolioSession', JSON.stringify({ token: 'first', expiresAt: original }))
    fetch.mockResolvedValueOnce(new Response('{}', { headers: { 'X-App-Session-Expires-At': renewed } }))
    await api.get('/me')
    expect(JSON.parse(sessionStorage.getItem('portfolioSession')).expiresAt).toBe(renewed)
    const pending = deferred()
    fetch.mockReturnValueOnce(pending.promise)
    const first = api.get('/me')
    sessionStorage.setItem('portfolioSession', JSON.stringify({ token: 'second', expiresAt: original }))
    pending.resolve(new Response('{}', { headers: { 'X-App-Session-Expires-At': renewed } }))
    await first
    expect(JSON.parse(sessionStorage.getItem('portfolioSession'))).toEqual({ token: 'second', expiresAt: original })
  })

  it('동시 조회 3개는 1회 요청하고, 완료 후 조회는 다시 요청한다', async () => {
    const pending = deferred()
    fetch.mockReturnValueOnce(pending.promise)
    const reads = [api.get('/jobs'), api.get('/jobs'), api.get('/jobs')]
    expect(fetch).toHaveBeenCalledTimes(1)
    pending.resolve(response({ postings: [1] }))
    expect(await Promise.all(reads)).toEqual(Array(3).fill({ postings: [1] }))
    fetch.mockResolvedValueOnce(response({ postings: [2] }))
    expect(await api.get('/jobs')).toEqual({ postings: [2] })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('계정 토큰이 바뀌면 이전 계정 조회를 공유하지 않는다', async () => {
    const pending = deferred()
    sessionStorage.setItem('portfolioSession', JSON.stringify({ token: 'first' }))
    fetch.mockReturnValueOnce(pending.promise)
    const first = api.get('/me')
    sessionStorage.setItem('portfolioSession', JSON.stringify({ token: 'second' }))
    fetch.mockResolvedValueOnce(response({ user: 'second' }))
    expect(await api.get('/me')).toEqual({ user: 'second' })
    pending.resolve(response({ user: 'first' }))
    await first
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('같은 방이어도 코드 입장과 계정 입장 조회는 분리한다', async () => {
    const pending = deferred()
    localStorage.setItem('roomDoor', JSON.stringify({ roomId: 'r1', door: 'code' }))
    fetch.mockReturnValueOnce(pending.promise)
    const first = api.get('/rooms/r1/view')
    localStorage.setItem('roomDoor', JSON.stringify({ roomId: 'r1', door: 'account' }))
    fetch.mockResolvedValueOnce(response({ role: 'company' }))
    expect(await api.get('/rooms/r1/view')).toEqual({ role: 'company' })
    pending.resolve(response({ role: 'candidate' }))
    await first
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('쓰기 뒤 조회는 쓰기 전에 진행 중이던 결과를 공유하지 않는다', async () => {
    const pending = deferred()
    fetch.mockReturnValueOnce(pending.promise)
    const first = api.get('/notifications')
    fetch.mockResolvedValueOnce(response({ ok: true }))
    await api.post('/notifications/read', {})
    fetch.mockResolvedValueOnce(response({ unread: 0 }))
    expect(await api.get('/notifications')).toEqual({ unread: 0 })
    pending.resolve(response({ unread: 2 }))
    await first
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('실패한 조회를 보관하지 않아 재시도할 수 있다', async () => {
    fetch.mockResolvedValueOnce(response({ error: 'temporary failure' }, 503))
    await expect(api.get('/jobs')).rejects.toThrow('temporary failure')
    fetch.mockResolvedValueOnce(response({ postings: [] }))
    await expect(api.get('/jobs')).resolves.toEqual({ postings: [] })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('쓰기가 끝나면 쓰는 중에 시작한 조회도 공유하지 않는다', async () => {
    const write = deferred()
    const read = deferred()
    fetch.mockReturnValueOnce(write.promise)
    const saving = api.post('/notifications/read', {})
    fetch.mockReturnValueOnce(read.promise)
    const duringWrite = api.get('/notifications')
    write.resolve(response({ ok: true }))
    await saving
    fetch.mockResolvedValueOnce(response({ unread: 0 }))
    expect(await api.get('/notifications')).toEqual({ unread: 0 })
    read.resolve(response({ unread: 2 }))
    await duringWrite
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
