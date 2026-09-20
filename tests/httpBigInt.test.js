import { expect, it } from 'vitest'
import { jsonResponse, jsonError } from '../server/_lib/http.js'

it('converts only bigint primitives into decimal strings, including nested arrays, without mutating input', async () => {
  const input = { safe: 9, fractional: 1.25, text: '9007199254740993', bool: true, nil: null,
    nested: [{ id: 9007199254740993n }, 0n, -9223372036854775808n], date: new Date('2026-09-19T00:00:00Z'), omitted: undefined }
  const response = jsonResponse(input, 202, { 'X-Fixture': 'preserved' })
  expect(response.status).toBe(202)
  expect(response.headers.get('X-Fixture')).toBe('preserved')
  expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate, private')
  expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(response.headers.get('Pragma')).toBe('no-cache')
  expect(await response.json()).toEqual({ safe: 9, fractional: 1.25, text: '9007199254740993', bool: true, nil: null,
    nested: [{ id: '9007199254740993' }, '0', '-9223372036854775808'], date: '2026-09-19T00:00:00.000Z' })
  expect(typeof input.nested[0].id).toBe('bigint')
  expect(() => JSON.stringify(1n)).toThrow() // No global BigInt/JSON monkey-patch.
})

it('preserves ordinary JSON response and error contracts byte-for-byte', async () => {
  const input = { count: 12, id: '12', values: [null, false, 'x'], child: { score: 1.5 } }
  const response = jsonResponse(input)
  expect(await response.text()).toBe(JSON.stringify(input))
  const error = jsonError('Synthetic validation error', 409)
  expect(error.status).toBe(409)
  expect(await error.json()).toEqual({ error: 'Synthetic validation error' })
})

it('does not suppress unrelated serialization errors', () => {
  const cyclic = {}; cyclic.self = cyclic
  expect(() => jsonResponse(cyclic)).toThrow(TypeError)
})
