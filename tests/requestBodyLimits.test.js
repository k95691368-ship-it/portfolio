import { afterEach, expect, it, vi } from 'vitest'
import { onRequest } from '../server/api/_middleware.js'

afterEach(() => vi.useRealTimers())
function run(request) {
  const next = vi.fn(async () => new Response(await context.request.text()))
  const context = { request, data: {}, env: { DB: {} }, next }
  return { response: onRequest(context), next }
}
const req = (body, path = '/api/login', headers = {}) => new Request(`https://test.invalid${path}`, {
  method: 'POST', body, headers, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
})

it.each([{}, { 'Content-Length': '1' }])('rejects oversized actual bytes even without a trustworthy Content-Length: %j', async (headers) => {
  const { response, next } = run(req('x'.repeat(256 * 1024 + 1), undefined, headers))
  expect((await response).status).toBe(413)
  expect(next).not.toHaveBeenCalled()
})

it('rejects an excessive declared size without reading the body', async () => {
  const pull = vi.fn()
  const body = new ReadableStream({ pull }, { highWaterMark: 0 })
  const { response, next } = run(req(body, undefined, { 'Content-Length': '999999999' }))
  expect((await response).status).toBe(413)
  expect(pull).not.toHaveBeenCalled()
  expect(next).not.toHaveBeenCalled()
})

it('keeps normal UTF-8 requests intact', async () => {
  const body = JSON.stringify({ message: '안녕하세요 👋', password: 'synthetic-test-value' })
  const { response } = run(req(body))
  expect(await (await response).text()).toBe(body)
})

it('preserves the existing signature and two-file application upload capacities', async () => {
  for (const [path, size] of [['/api/rooms/one/sign', 2_000_100], ['/api/jobs/one/apply', 20 * 1024 * 1024 + 1000]]) {
    const { response } = run(req('x'.repeat(size), path))
    expect((await response).status).toBe(200)
  }
})

it('cancels an over-limit chunked stream without reading the rest', async () => {
  const cancel = vi.fn()
  let pulls = 0
  const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(65536)) }, cancel }, { highWaterMark: 0 })
  const { response, next } = run(req(stream))
  expect((await response).status).toBe(413)
  expect(pulls).toBe(5)
  expect(cancel).toHaveBeenCalled()
  expect(next).not.toHaveBeenCalled()
})

it('cancels a stalled body after the read deadline', async () => {
  vi.useFakeTimers()
  const cancel = vi.fn()
  const { response, next } = run(req(new ReadableStream({ cancel })))
  await vi.advanceTimersByTimeAsync(30_001)
  expect((await response).status).toBe(408)
  expect(cancel).toHaveBeenCalled()
  expect(next).not.toHaveBeenCalled()
})

it('preserves a request fragmented into 20,000 tiny chunks', async () => {
  let chunks = 0
  const stream = new ReadableStream({ pull(controller) {
    if (chunks++ === 20_000) controller.close()
    else controller.enqueue(new Uint8Array([97]))
  } }, { highWaterMark: 0 })
  const { response } = run(req(stream))
  expect(await (await response).text()).toBe('a'.repeat(20_000))
})

it('allows a slow upload beyond the normal JSON deadline but still imposes an upload deadline', async () => {
  vi.useFakeTimers()
  const cancel = vi.fn()
  const { response } = run(req(new ReadableStream({ cancel }), '/api/jobs/one/apply'))
  await vi.advanceTimersByTimeAsync(30_001)
  expect(cancel).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(90_000)
  expect((await response).status).toBe(408)
  expect(cancel).toHaveBeenCalled()
})
