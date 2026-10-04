import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { withRequestDeadline } from '../src/api/requestDeadline.js'
const storage = () => ({ getItem: () => null, setItem() {}, removeItem() {} })
let api
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules()
  vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage()); vi.stubGlobal('fetch', vi.fn())
  api = (await import('../src/api/client.js')).api
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('times out a shared GET, aborts its fetch and allows a fresh request afterwards', async () => {
  fetch.mockImplementationOnce(() => new Promise(() => {}))
  const one = api.get('/jobs'); const two = api.get('/jobs')
  const results = Promise.allSettled([one, two])
  expect(fetch).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(120_000)
  expect((await results).map((r) => r.reason.code)).toEqual(['REQUEST_TIMEOUT', 'REQUEST_TIMEOUT'])
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
  fetch.mockResolvedValueOnce(Response.json({ postings: [] }))
  expect(await api.get('/jobs')).toEqual({ postings: [] })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
})

it('starts a fresh cancellable GET when a previous caller aborts in the same tick', async () => {
  fetch.mockImplementationOnce(() => new Promise(() => {}))
  fetch.mockResolvedValueOnce(Response.json({ applications: [{ id: 'latest' }] }))
  const firstController = new AbortController(), secondController = new AbortController()
  const first = api.get('/applications', { signal: firstController.signal })
  const firstResult = Promise.allSettled([first])
  firstController.abort()
  const second = api.get('/applications', { signal: secondController.signal })
  expect(second).not.toBe(first)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(await second).toEqual({ applications: [{ id: 'latest' }] })
  expect((await firstResult)[0].reason.name).toBe('AbortError')
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
  expect(fetch.mock.calls[1][1].signal.aborted).toBe(false)
  expect(secondController.signal.aborted).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

it('shares GETs without caller signals while an independently cancellable GET uses its own fetch', async () => {
  let finishShared
  fetch.mockImplementationOnce(() => new Promise(resolve => { finishShared = resolve }))
  fetch.mockImplementationOnce(() => new Promise(() => {}))
  const sharedOne = api.get('/applications'), sharedTwo = api.get('/applications')
  const controller = new AbortController()
  const cancellable = api.get('/applications', { signal: controller.signal })
  const cancelled = Promise.allSettled([cancellable])
  expect(sharedOne).toBe(sharedTwo)
  expect(cancellable).not.toBe(sharedOne)
  expect(fetch).toHaveBeenCalledTimes(2)
  controller.abort()
  expect((await cancelled)[0].reason.name).toBe('AbortError')
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false)
  finishShared(Response.json({ applications: [] }))
  expect(await sharedOne).toEqual({ applications: [] })
  expect(await sharedTwo).toEqual({ applications: [] })
  expect(vi.getTimerCount()).toBe(0)
})

it('does not fetch an already cancelled GET even while the same path has a shared read in flight', async () => {
  let finishShared
  fetch.mockImplementationOnce(() => new Promise(resolve => { finishShared = resolve }))
  const shared = api.get('/applications')
  const controller = new AbortController(); controller.abort()
  await expect(api.get('/applications', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetch).toHaveBeenCalledTimes(1)
  finishShared(Response.json({ applications: [] }))
  expect(await shared).toEqual({ applications: [] })
  expect(vi.getTimerCount()).toBe(0)
})

it('includes response-body reading in the deadline and never automatically retries a write', async () => {
  fetch.mockResolvedValueOnce({ ok: true, headers: new Headers(), json: () => new Promise(() => {}) })
  const result = Promise.allSettled([api.post('/postings', {})])
  await vi.advanceTimersByTimeAsync(120_000)
  expect((await result)[0].reason.code).toBe('REQUEST_TIMEOUT')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('honors caller cancellation and cleans up the deadline', async () => {
  const controller = new AbortController()
  fetch.mockImplementationOnce(() => new Promise(() => {}))
  const result = Promise.allSettled([api.post('/rooms/one/interviews/two/signaling', {}, { signal: controller.signal })])
  controller.abort()
  expect((await result)[0].reason.name).toBe('AbortError')
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('does not start an operation already cancelled by its caller', async () => {
  const controller = new AbortController(); controller.abort()
  const operation = vi.fn()
  await expect(withRequestDeadline(operation, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(operation).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('allows longer file uploads while still releasing a stuck upload', async () => {
  fetch.mockImplementationOnce(() => new Promise(() => {}))
  const result = Promise.allSettled([api.upload('/documents/upload', new FormData())])
  await vi.advanceTimersByTimeAsync(120_000)
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(180_000)
  expect((await result)[0].reason.code).toBe('REQUEST_TIMEOUT')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('never installs a login token from a response that completes after timing out', async () => {
  let finishBody
  const body = new Promise((resolve) => { finishBody = resolve })
  fetch.mockResolvedValueOnce({ ok: true, headers: new Headers(), json: () => body })
  const store = vi.spyOn(localStorage, 'setItem')
  const result = Promise.allSettled([api.post('/login', {})])
  await vi.advanceTimersByTimeAsync(120_000)
  expect((await result)[0].reason.code).toBe('REQUEST_TIMEOUT')
  finishBody({ sessionToken: 'synthetic-late-token' })
  await vi.advanceTimersByTimeAsync(0)
  expect(store).not.toHaveBeenCalled()
})
