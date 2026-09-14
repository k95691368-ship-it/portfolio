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
