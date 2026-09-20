import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSupabaseStorage } from '../supabase/functions/api/supabaseStorage.ts'

let storage
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  storage = createSupabaseStorage({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only' }, 'documents')
})
afterEach(() => vi.unstubAllGlobals())

it.each(['../private.pdf', 'room/../private.pdf', './file.pdf', 'room\\file.pdf', '/file.pdf', 'file\u0000.pdf'])('rejects unsafe storage keys before issuing requests: %s', async (key) => {
  await expect(storage.get(key)).rejects.toThrow()
  await expect(storage.delete(key)).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['get', 'head', 'put', 'delete', 'createSignedUrl', 'createSignedUploadUrl'])('%s sets a deadline and refuses credential-bearing redirects', async (method) => {
  fetch.mockResolvedValueOnce(Response.json({ signedURL: '/object/sign/documents/test?token=example', url: '/object/upload/sign/documents/test?token=example' }, { headers: { 'Content-Length': '1' } }))
  await storage[method]('folder/file.pdf', method === 'put' ? new Uint8Array([1]) : undefined)
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) })
})

it.each(['head', 'delete'])('%s cancels an unused response body', async (method) => {
  const cancel = vi.fn()
  fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Range': 'bytes 0-0/123' } }))
  await storage[method]('file.pdf')
  expect(cancel).toHaveBeenCalledTimes(1)
})

it.each(['head', 'get', 'delete'])('%s cancels a missing-object response', async (method) => {
  const cancel = vi.fn()
  fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 404 }))
  await storage[method]('file.pdf')
  expect(cancel).toHaveBeenCalledTimes(1)
})

it('does not leak provider response data into error logs', async () => {
  fetch.mockResolvedValueOnce(Response.json({ message: 'private provider diagnostics' }, { status: 500 }))
  await expect(storage.get('file.pdf')).rejects.toThrow('Supabase Storage request failed (500)')
})

it('preserves streaming downloads and UTF-8 object names', async () => {
  fetch.mockResolvedValueOnce(new Response('pdf body', { headers: { 'Content-Length': '8', 'Content-Type': 'application/pdf' } }))
  const object = await storage.get('room/계약서.pdf')
  expect(fetch.mock.calls[0][0]).toContain('room/%EA%B3%84%EC%95%BD%EC%84%9C.pdf')
  expect(object.size).toBe(8)
  expect(await new Response(object.body).text()).toBe('pdf body')
})

it.each([
  { offset: 2, length: 3 },
  { range: { offset: 2, length: 3 } },
])('serves the requested bytes for flat and route-shaped ranges: %j', async (options) => {
  const response = new Response('cde', { status: 206, headers: {
    'Content-Range': 'bytes 2-4/10', 'Content-Length': '3', 'Content-Type': 'video/mp4',
  } })
  fetch.mockResolvedValueOnce(response)
  const object = await storage.get('recording.mp4', options)
  expect(new Headers(fetch.mock.calls[0][1].headers).get('Range')).toBe('bytes=2-4')
  expect(new Headers(fetch.mock.calls[0][1].headers).get('Accept-Encoding')).toBe('identity')
  expect(object).toMatchObject({ size: 10, range: { offset: 2 }, httpMetadata: { contentType: 'video/mp4' } })
  expect(object.body).toBe(response.body)
  expect(await new Response(object.body).text()).toBe('cde')
})

it('supports an open-ended range without buffering the response', async () => {
  fetch.mockResolvedValueOnce(new Response('def', { status: 206, headers: { 'Content-Range': 'bytes 3-5/6' } }))
  const object = await storage.get('recording.mp4', { range: { offset: 3 } })
  expect(new Headers(fetch.mock.calls[0][1].headers).get('Range')).toBe('bytes=3-')
  expect(object).toMatchObject({ size: 6, range: { offset: 3 } })
  expect(await new Response(object.body).text()).toBe('def')
})

it.each([
  { offset: -1, length: 3 }, { offset: 0.5, length: 3 }, { offset: NaN }, { offset: Infinity },
  { offset: 0, length: 0 }, { offset: 0, length: -1 }, { offset: 0, length: 1.5 },
  { offset: Number.MAX_SAFE_INTEGER, length: 2 },
])('rejects invalid ranges before issuing a request: %j', async (range) => {
  await expect(storage.get('recording.mp4', { range })).rejects.toThrow('Invalid storage range')
  expect(fetch).not.toHaveBeenCalled()
})

it.each([
  { status: 200, headers: { 'Content-Length': '10' } },
  { status: 200, headers: { 'Content-Range': 'bytes 2-4/10', 'Content-Length': '3' } },
  { status: 206, headers: {} },
  { status: 206, headers: { 'Content-Range': 'bytes 0-2/10', 'Content-Length': '3' } },
  { status: 206, headers: { 'Content-Range': 'bytes 2-5/10', 'Content-Length': '4' } },
  { status: 206, headers: { 'Content-Range': 'bytes 2-4/4', 'Content-Length': '3' } },
  { status: 206, headers: { 'Content-Range': 'bytes 2-4/*', 'Content-Length': '3' } },
  { status: 206, headers: { 'Content-Range': 'bytes 2-4/9007199254740992', 'Content-Length': '3' } },
  { status: 206, headers: { 'Content-Range': 'bytes 2-4/10', 'Content-Length': '10' } },
  { status: 206, headers: { 'Content-Range': 'bytes 2-4/10', 'Content-Encoding': 'gzip' } },
])('rejects and cancels ignored or mismatched provider ranges: %j', async (init) => {
  const cancel = vi.fn()
  fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), init))
  await expect(storage.get('recording.mp4', { range: { offset: 2, length: 3 } }))
    .rejects.toThrow('Supabase Storage returned an invalid range response')
  expect(cancel).toHaveBeenCalledTimes(1)
})

it('rejects and cancels an unsolicited partial response to a full download', async () => {
  const cancel = vi.fn()
  fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), {
    status: 206, headers: { 'Content-Range': 'bytes 0-0/10', 'Content-Length': '1' },
  }))
  await expect(storage.get('recording.mp4')).rejects.toThrow('Supabase Storage returned an unexpected partial response')
  expect(cancel).toHaveBeenCalledTimes(1)
})
