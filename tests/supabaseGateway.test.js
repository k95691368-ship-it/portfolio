import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ handle: vi.fn(), middleware: vi.fn() }))
vi.mock('../supabase/functions/api/postgresD1.ts', () => ({ createPostgresD1: () => ({}) }))
vi.mock('../supabase/functions/api/supabaseStorage.ts', () => ({ createSupabaseStorage: () => ({}) }))
vi.mock('../supabase/functions/api/routes.generated.js', () => ({ routes: [
  { pattern: /^\/probe(?:\/([^/]+))?$/, params: ['id'], module: { onRequestGet: mocks.handle } },
] }))
vi.mock('../server/api/_middleware.js', () => ({ onRequest: mocks.middleware }))
vi.mock('../server/api/admin/_middleware.js', () => ({ onRequest: ({ next }) => next() }))

let gateway
const origin = 'https://portfolio-epa.pages.dev'
beforeEach(async () => {
  vi.resetModules()
  mocks.handle.mockReset().mockResolvedValue(new Response('ok', { headers: { 'Set-Cookie': 'test-only=value' } }))
  mocks.middleware.mockReset().mockImplementation(({ next }) => next())
  vi.stubGlobal('Deno', { env: { toObject: () => ({}) }, serve: (handler) => { gateway = handler } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await import('../supabase/functions/api/index.ts')
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function request(path, { method = 'GET', requestOrigin = origin } = {}) {
  return new Request(`https://edge.test.invalid/functions/v1/api${path}`, { method, headers: { Origin: requestOrigin } })
}
function secureError(response, status) {
  expect(response.status).toBe(status)
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(response.headers.get('Cache-Control')).toContain('private')
  expect(response.headers.get('Pragma')).toBe('no-cache')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
  expect(response.headers.get('Vary')).toContain('Cookie')
  expect(response.headers.get('Vary')).toContain('X-App-Authorization')
}

it('protects route-not-found responses and preserves allowed CORS headers', async () => {
  const response = await gateway(request('/missing'))
  secureError(response, 404)
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
  expect(mocks.middleware).not.toHaveBeenCalled()
})

it('protects unsupported-method responses', async () => {
  const response = await gateway(request('/probe', { method: 'PATCH' }))
  secureError(response, 405)
  expect(response.headers.get('Allow')).toContain('GET')
  expect(mocks.handle).not.toHaveBeenCalled()
})

it('protects origin rejection responses without granting cross-origin access', async () => {
  const response = await gateway(request('/probe', { requestOrigin: 'https://outside.invalid' }))
  secureError(response, 403)
  expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
  expect(mocks.middleware).not.toHaveBeenCalled()
})

it('protects unexpected-error responses without returning private diagnostics', async () => {
  mocks.handle.mockRejectedValue(new Error('private database diagnostics'))
  const response = await gateway(request('/probe'))
  secureError(response, 500)
  expect(await response.text()).not.toContain('private database diagnostics')
})

it('rejects malformed encoded route parameters without invoking the handler', async () => {
  const response = await gateway(request('/probe/%ZZ'))
  secureError(response, 400)
  expect(mocks.handle).not.toHaveBeenCalled()
})

it('preserves preflight and strips legacy cookies from successful responses', async () => {
  expect((await gateway(request('/probe', { method: 'OPTIONS' }))).status).toBe(204)
  expect(mocks.middleware).not.toHaveBeenCalled()
  const response = await gateway(request('/probe'))
  expect(response.status).toBe(200)
  expect(response.headers.has('Set-Cookie')).toBe(false)
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
  expect(mocks.middleware).toHaveBeenCalledTimes(1)
})
