import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false, user: { id: 'candidate', role: 'candidate' }, params: null }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('react', async original => ({ ...await original(),
  useState(initial) { const cell = host.cells[host.index++] ||= { value: typeof initial === 'function' ? initial() : initial }; return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; host.dirty = true }] },
  useRef(value) { return host.cells[host.index++] ||= { current: value } },
  useEffect(effect, deps) {
    const index = host.index++
    if (!host.cells[index] || deps.some((value, i) => !Object.is(value, host.cells[index].deps[i]))) {
      host.cells[index]?.cleanup?.(); host.cells[index] = { deps }
      host.effects.push(() => { host.cells[index].cleanup = effect() })
    }
  },
}))
vi.mock('react-router-dom', () => ({ Link: 'test-link', useSearchParams: () => [host.params] }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: host.user }) }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
import { api } from '../src/api/client.js'
import ApplicationStatusPage from '../src/pages/ApplicationStatusPage.jsx'
let tree
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const button = label => walk(tree).find(node => node.type === 'button' && text(node) === label)
const input = () => walk(tree).find(node => node.type === 'input')
const form = () => walk(tree).find(node => node.type === 'form')
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }
const result = title => ({ postingTitle: title, applicantName: '가*', status: 'submitted', submittedAt: '2026-01-01T00:00:00Z' })
function render() {
  for (let n = 0; n < 12; n++) { host.index = 0; host.effects = []; host.dirty = false; tree = ApplicationStatusPage(); for (const effect of host.effects) effect(); if (!host.dirty) return tree }
  throw new Error('render loop')
}
async function settle() { for (let n = 0; n < 20; n++) await Promise.resolve(); render() }
const change = code => { input().props.onChange({ target: { value: code } }); render() }
const submit = () => { form().props.onSubmit({ preventDefault() {} }); render() }
beforeEach(() => { vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.user = { id: 'candidate', role: 'candidate' }; host.params = new URLSearchParams(); api.get.mockResolvedValue(result('Role A')); api.post.mockResolvedValue({ ok: true }) })
afterEach(() => { for (const cell of host.cells) cell.cleanup?.() })

it('invalidates a displayed receipt on edit and connects exactly the confirmed normalized code', async () => {
  render(); change('  abcd2345ef  '); submit(); await settle()
  expect(text(tree)).toContain('ABCD2345EF')
  const previousClaim = button('접수번호로 내 계정에 연결').props.onClick
  change('BCDE2345FG')
  expect(text(tree)).not.toContain('Role A')
  expect(button('접수번호로 내 계정에 연결')).toBeUndefined()
  await previousClaim()
  expect(api.post).not.toHaveBeenCalled()
  api.get.mockResolvedValueOnce(result('Role B')); submit(); await settle()
  await button('접수번호로 내 계정에 연결').props.onClick(); await settle()
  expect(api.post.mock.calls[0][1]).toEqual({ code: 'BCDE2345FG' })
  expect(text(tree)).toContain('이 지원서를 본인 계정에 연결했습니다.')
  expect(button('접수번호로 내 계정에 연결')).toBeUndefined()
})

it('coalesces the same-tick lookup and claim, locking the claim target while its result is pending', async () => {
  const lookup = deferred(); const linking = deferred()
  api.get.mockReturnValueOnce(lookup.promise); api.post.mockReturnValueOnce(linking.promise)
  render(); change('ABCD2345EF')
  const handler = form().props.onSubmit; handler({ preventDefault() {} }); handler({ preventDefault() {} }); render()
  expect(api.get).toHaveBeenCalledTimes(1)
  lookup.resolve(result('Role A')); await settle()
  const claim = button('접수번호로 내 계정에 연결').props.onClick; const editing = input().props.onChange
  claim(); claim(); editing({ target: { value: 'BCDE2345FG' } }); render()
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(input().props.disabled).toBe(true)
  expect(input().props.value).toBe('ABCD2345EF')
  linking.resolve({ ok: true }); await settle()
  expect(toast.success).toHaveBeenCalledTimes(1)
})

it('aborts an edited lookup and ignores its late result/error and loading completion after a new query', async () => {
  const old = deferred(), latest = deferred()
  api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
  render(); change('ABCD2345EF'); submit()
  const signal = api.get.mock.calls[0][1].signal
  change('BCDE2345FG'); submit()
  expect(signal.aborted).toBe(true)
  old.reject(new Error('Old failure')); await settle()
  expect(text(tree)).not.toContain('Old failure')
  expect(button('조회 중...')).toBeDefined()
  latest.resolve(result('Latest')); await settle()
  expect(text(tree)).toContain('Latest')
  expect(text(tree)).toContain('BCDE2345FG')
})

it('preserves the newest result when an older response eventually arrives', async () => {
  const old = deferred(), latest = deferred()
  api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
  render(); change('ABCD2345EF'); submit(); change('BCDE2345FG'); submit()
  latest.resolve(result('Latest')); await settle(); old.resolve(result('Old')); await settle()
  expect(text(tree)).toContain('Latest')
  expect(text(tree)).not.toContain('Old')
})

it('cancels without displaying a late receipt and permits a new GET-only retry', async () => {
  const pending = deferred(); api.get.mockReturnValueOnce(pending.promise)
  render(); change('ABCD2345EF'); submit(); button('조회 취소').props.onClick(); render()
  expect(api.get.mock.calls[0][1].signal.aborted).toBe(true)
  pending.resolve(result('Cancelled')); await settle()
  expect(text(tree)).not.toContain('Cancelled')
  submit(); await settle(); expect(text(tree)).toContain('Role A')
  expect(api.post).not.toHaveBeenCalled()
})

it.each(['lookup', 'claim'])('aborts %s on exit and never publishes a late result or success', async type => {
  const pending = deferred()
  if (type === 'lookup') api.get.mockReturnValueOnce(pending.promise)
  else api.post.mockReturnValueOnce(pending.promise)
  render(); change('ABCD2345EF'); submit(); await settle()
  if (type === 'claim') button('접수번호로 내 계정에 연결').props.onClick()
  for (const cell of host.cells) cell.cleanup?.()
  host.dirty = false
  pending.resolve(type === 'lookup' ? result('Late') : { ok: true })
  for (let n = 0; n < 20; n++) await Promise.resolve()
  expect((type === 'lookup' ? api.get : api.post).mock.calls[0][type === 'lookup' ? 1 : 2].signal.aborted).toBe(true)
  expect(host.dirty).toBe(false)
  expect(toast.success).not.toHaveBeenCalled()
})

it('renders errors instead of a false success for malformed GET and claim responses', async () => {
  api.get.mockResolvedValueOnce({ ...result('Malformed'), status: 'constructor' }); render(); change('ABCD2345EF'); submit(); await settle()
  expect(text(tree)).toContain('지원 현황 응답을 확인하지 못했습니다.')
  expect(button('접수번호로 내 계정에 연결')).toBeUndefined()
  submit(); await settle(); api.post.mockResolvedValueOnce({})
  await button('접수번호로 내 계정에 연결').props.onClick(); await settle()
  expect(text(tree)).toContain('계정 연결 결과를 확인하지 못했습니다.')
  expect(toast.success).not.toHaveBeenCalled()
})

it('does not report a previous account claim after identity changes, and auto-queries a URL receipt', async () => {
  host.params = new URLSearchParams('code=abcd2345ef'); const pending = deferred(); api.post.mockReturnValueOnce(pending.promise)
  render(); await settle()
  expect(api.get.mock.calls[0][0]).toBe('/application-status?code=ABCD2345EF')
  button('접수번호로 내 계정에 연결').props.onClick()
  host.user = { id: 'other', role: 'candidate' }; render()
  pending.resolve({ ok: true }); await settle()
  expect(toast.success).not.toHaveBeenCalled()
  expect(text(tree)).not.toContain('이 지원서를 본인 계정에 연결했습니다.')
})
