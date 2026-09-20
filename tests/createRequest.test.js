import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, cleanup: null }))
vi.mock('react', () => ({
  useRef: initial => host.cells[host.index++] ||= { current: initial },
  useState(initial) {
    const cell = host.cells[host.index++] ||= { value: initial }
    return [cell.value, value => { cell.value = value }]
  },
  useEffect(effect) {
    if (!host.cells[host.index++]) { host.cells[host.index - 1] = true; host.cleanup = effect() }
  },
}))
vi.mock('../src/api/client.js', () => ({ api: { post: vi.fn() } }))
import { api } from '../src/api/client.js'
import { useCreateRequest } from '../src/hooks/useCreateRequest.js'

function CreateRequestHarness() { host.index = 0; return useCreateRequest('/postings') }
const render = CreateRequestHarness
beforeEach(() => { vi.resetAllMocks(); host.cells = []; host.index = 0; host.cleanup = null })
afterEach(() => host.cleanup?.())

it('uses a new operation only after a confirmed result and never persists submitted data', async () => {
  api.post.mockResolvedValue({ id: 'first' })
  const storage = { setItem: vi.fn() }; vi.stubGlobal('sessionStorage', storage)
  try {
    await render().run({ title: 'same' }); await render().run({ title: 'same' })
    expect(api.post.mock.calls[0][1].operationId).not.toBe(api.post.mock.calls[1][1].operationId)
    expect(render().unconfirmed).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})

it.each([undefined, 408, 500, 502, 503, 504])('retains the original snapshot and key after uncertain status %s', async status => {
  api.post.mockRejectedValueOnce(Object.assign(new Error('Unconfirmed'), { status }))
  const original = { title: 'first', nested: { value: 'submitted' } }
  await expect(render().run(original)).rejects.toThrow('Unconfirmed')
  original.nested.value = 'changed'
  expect(render().unconfirmed).toBe(true)
  api.post.mockResolvedValueOnce({ id: 'stored', recovered: true })
  expect(await render().run({ title: 'different' })).toMatchObject({ id: 'stored' })
  expect(api.post.mock.calls[1][1]).toEqual(api.post.mock.calls[0][1])
  expect(api.post.mock.calls[1][1].nested.value).toBe('submitted')
  expect(render().unconfirmed).toBe(false)
})

it.each([400, 401, 403, 409, 410, 413, 422, 429])('allows a corrected new operation after definite rejection %s', async status => {
  api.post.mockRejectedValueOnce(Object.assign(new Error('Rejected'), { status }))
  await expect(render().run({ title: 'bad' })).rejects.toThrow('Rejected')
  expect(render().unconfirmed).toBe(false)
  api.post.mockResolvedValueOnce({ id: 'stored' })
  await render().run({ title: 'corrected' })
  expect(api.post.mock.calls[1][1].title).toBe('corrected')
  expect(api.post.mock.calls[1][1].operationId).not.toBe(api.post.mock.calls[0][1].operationId)
})

it('does not start a second request before React can commit a disabled button', async () => {
  let finish; api.post.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const request = render(); const first = request.run({ title: 'one' })
  expect(request.inFlight()).toBe(true)
  expect(await request.run({ title: 'two' })).toBeNull()
  expect(api.post).toHaveBeenCalledOnce()
  finish({ id: 'one' }); await first
  expect(request.inFlight()).toBe(false)
})

it.each([null, {}, { id: '' }])('does not claim success for a malformed response %j', async result => {
  api.post.mockResolvedValueOnce(result)
  await expect(render().run({ title: 'one' })).rejects.toThrow('생성 결과를 확인하지 못했습니다')
  expect(render().unconfirmed).toBe(true)
})

it('does not hand a late response to an unmounted or changed-account page', async () => {
  let finish; api.post.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const pending = render().run({ title: 'old' }); host.cleanup()
  finish({ id: 'old' }); expect(await pending).toBeNull()
  api.post.mockRejectedValueOnce(Object.assign(new Error('Old identity'), { code: 'STALE_AUTH_RESPONSE' }))
  host.cells = []; host.index = 0
  expect(await render().run({ title: 'old' })).toBeNull()
})
