import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false, updates: 0 }))
const navigate = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }))
vi.mock('react', async original => ({
  ...await original(),
  useState(initial) {
    const cell = host.cells[host.index++] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; host.dirty = true; host.updates++ }]
  },
  useRef(value) { return host.cells[host.index++] ||= { current: value } },
  useEffect(effect, deps) {
    const index = host.index++, previous = host.cells[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      host.cells[index] = { deps, effect, cleanup: previous?.cleanup }
      host.effects.push(() => { previous?.cleanup?.(); host.cells[index].cleanup = effect() })
    }
  },
}))
vi.mock('react-router-dom', () => ({ Link: 'test-link', useNavigate: () => navigate }))
vi.mock('../src/api/client.js', () => ({ api: { post: vi.fn() } }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: vi.fn() }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
vi.mock('../src/lib/accountLinkToken.js', async original => {
  const actual = await original()
  return { ...actual, forgetAccountLinkToken: vi.fn(actual.forgetAccountLinkToken) }
})

import { api } from '../src/api/client.js'
import { useAuth } from '../src/context/AuthContext.jsx'
import { readAccountLinkToken, forgetAccountLinkToken } from '../src/lib/accountLinkToken.js'
import ResetPasswordPage from '../src/pages/ResetPasswordPage.jsx'
import VerifyEmailPage from '../src/pages/VerifyEmailPage.jsx'
import ChangePasswordPage from '../src/pages/ChangePasswordPage.jsx'

let Component, tree, auth
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const form = () => walk(tree).find(node => node.type === 'form')
const button = label => walk(tree).find(node => node.type === 'button' && text(node) === label)
const passwords = () => walk(tree).filter(node => node.type === 'input' && node.props.type === 'password')
const submit = () => form().props.onSubmit({ preventDefault() {} })
function render() {
  for (let count = 0; count < 12; count++) {
    host.index = 0; host.effects = []; host.dirty = false; tree = Component()
    for (const effect of host.effects) effect()
    if (!host.dirty) return
  }
  throw new Error('Render loop')
}
function unmount() { for (const cell of host.cells) cell.cleanup?.() }
async function settle() { for (let count = 0; count < 16; count++) await Promise.resolve(); render() }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const account = { id: 'fixture-account', email: 'fixture@example.invalid', role: 'candidate', displayName: 'Fixture', mustChangePassword: false, emailVerified: true,
  isAdmin: false, isRecruiter: false, isDeveloper: false }
function mount(kind) {
  Component = { reset: ResetPasswordPage, verify: VerifyEmailPage, change: ChangePasswordPage }[kind]
  window.location.pathname = kind === 'reset' ? '/reset-password' : '/verify-email'
  // Synthetic capability stays inside the test; assertions never print it.
  window.location.hash = `#token=${'x'.repeat(43)}`
  render()
  for (const input of passwords()) input.props.onChange({ target: { value: 'synthetic-password-for-test' } })
  render()
}
const response = kind => kind === 'verify' ? account : { ok: true }

beforeEach(() => {
  forgetAccountLinkToken(); vi.resetAllMocks()
  host.cells = []; host.index = 0; host.effects = []; host.dirty = false; host.updates = 0
  const location = { pathname: '/verify-email', hash: '', replace: vi.fn() }
  vi.stubGlobal('window', { location, history: { state: null, replaceState: vi.fn((_state, _title, path) => { location.pathname = path; location.hash = '' }) } })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External traffic is forbidden in this test') }))
  auth = { user: { ...account, mustChangePassword: true }, refresh: vi.fn().mockResolvedValue(account),
    verifyEmail: vi.fn(async (token, password, callbacks = {}) => {
      const user = await api.post('/account/verify-email', { token, password })
      if (callbacks.isCurrent?.() !== false) callbacks.onVerified?.(user)
      return user
    }) }
  useAuth.mockReturnValue(auth)
})
afterEach(() => { unmount(); forgetAccountLinkToken(); vi.unstubAllGlobals() })

it.each(['reset', 'verify', 'change'])('deduplicates same-tick %s completion requests', async kind => {
  mount(kind)
  const request = deferred()
  api.post.mockReturnValue(request.promise)
  const first = submit(), second = submit()
  const count = api.post.mock.calls.length
  request.resolve(response(kind)); await Promise.all([first, second]); await settle()
  expect(count).toBe(1)
})

it.each(['reset', 'verify', 'change'])('does not confirm %s completion for a malformed 200 response', async kind => {
  mount(kind)
  api.post.mockResolvedValueOnce({})
  await submit(); await settle()
  expect(!!form()).toBe(true)
  expect(forgetAccountLinkToken.mock.calls.length).toBe(0)
  expect(navigate.mock.calls.length).toBe(0)
  expect(toast.success.mock.calls.length).toBe(0)
  expect(auth.refresh.mock.calls.length).toBe(0)
  if (kind !== 'change') expect(!!readAccountLinkToken()).toBe(true)
})

it.each(['reset', 'verify', 'change'])('ignores late %s completion after unmount', async kind => {
  mount(kind)
  const request = deferred()
  api.post.mockReturnValueOnce(request.promise)
  const sending = submit(); render(); unmount()
  const updates = host.updates
  request.resolve(response(kind)); await sending
  expect(host.updates).toBe(updates)
  expect(forgetAccountLinkToken.mock.calls.length).toBe(0)
  expect(navigate.mock.calls.length).toBe(0)
  expect(toast.success.mock.calls.length).toBe(0)
  expect(auth.refresh.mock.calls.length).toBe(0)
})

it('keeps a confirmed password change separate from a failed session refresh', async () => {
  mount('change')
  api.post.mockResolvedValueOnce({ ok: true })
  auth.refresh.mockRejectedValueOnce(new Error('Synthetic session lookup failure'))
  await submit(); await settle()
  expect(toast.success.mock.calls.length).toBe(1)
  expect(navigate.mock.calls.length).toBe(0)
  expect(api.post.mock.calls.length).toBe(1)
  expect(text(tree)).toContain('변경')
})

it.each(['reset', 'verify', 'change'])('completes the normal %s response exactly once', async kind => {
  mount(kind)
  const handler = form().props.onSubmit
  api.post.mockResolvedValueOnce(response(kind))
  await handler({ preventDefault() {} })
  await handler({ preventDefault() {} })
  await settle()
  expect(api.post.mock.calls.length).toBe(1)
  if (kind === 'reset') {
    expect(text(tree)).toContain('비밀번호를 변경했습니다')
    expect(!!readAccountLinkToken()).toBe(false)
    expect(!!form()).toBe(false)
  } else if (kind === 'verify') {
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true })
    expect(forgetAccountLinkToken.mock.calls.length).toBe(1)
    expect(!!readAccountLinkToken()).toBe(false)
  } else {
    expect(auth.refresh.mock.calls.length).toBe(1)
    expect(toast.success.mock.calls.length).toBe(1)
    expect(navigate).toHaveBeenCalledWith('/dashboard')
  }
})

it('finishes email proof and navigation before session publication remounts the page', async () => {
  mount('verify')
  auth.verifyEmail.mockImplementationOnce(async (_token, _password, options) => {
    expect(options.signal.aborted).toBe(false)
    expect(options.isCurrent()).toBe(true)
    options.onVerified(account)
    expect(navigate.mock.calls.length).toBe(1)
    expect(forgetAccountLinkToken.mock.calls.length).toBe(1)
    unmount()
    return account
  })
  await submit()
  expect(navigate.mock.calls.length).toBe(1)
  expect(forgetAccountLinkToken.mock.calls.length).toBe(1)
})

it('aborts only the departed verification request and keeps its proof', async () => {
  mount('verify')
  const request = deferred()
  api.post.mockReturnValueOnce(request.promise)
  const sending = submit()
  const options = auth.verifyEmail.mock.calls[0][2]
  unmount()
  expect(options.signal.aborted).toBe(true)
  expect(options.isCurrent()).toBe(false)
  request.resolve(account); await sending
  expect(!!readAccountLinkToken()).toBe(true)
  expect(navigate.mock.calls.length).toBe(0)
})

it('does not finish verification without its confirmed-account callback', async () => {
  mount('verify')
  auth.verifyEmail.mockResolvedValueOnce(account)
  await submit(); await settle()
  expect(navigate.mock.calls.length).toBe(0)
  expect(forgetAccountLinkToken.mock.calls.length).toBe(0)
  expect(text(tree)).toContain('결과를 확인하지 못했습니다')
})

it.each(['mustChangePassword', 'emailVerified', 'isAdmin'])('keeps verification proof when the %s field is invalid', async field => {
  mount('verify')
  api.post.mockResolvedValueOnce({ ...account, [field]: undefined })
  await submit(); await settle()
  expect(!!readAccountLinkToken()).toBe(true)
  expect(navigate.mock.calls.length).toBe(0)
  expect(forgetAccountLinkToken.mock.calls.length).toBe(0)
})

it.each(['reset', 'verify', 'change'])('does not act on a late %s failure after unmount', async kind => {
  mount(kind)
  const request = deferred()
  api.post.mockReturnValueOnce(request.promise)
  const sending = submit(); render(); unmount()
  const updates = host.updates
  request.reject(new Error('Synthetic unavailable response')); await sending
  expect(host.updates).toBe(updates)
  expect(toast.error.mock.calls.length).toBe(0)
  expect(navigate.mock.calls.length).toBe(0)
  expect(forgetAccountLinkToken.mock.calls.length).toBe(0)
})

it('retries only session lookup after a confirmed password change', async () => {
  mount('change')
  api.post.mockResolvedValueOnce({ ok: true })
  auth.refresh.mockRejectedValueOnce(new Error('Synthetic unavailable session')).mockResolvedValueOnce(account)
  await submit(); await settle()
  expect(text(tree)).toContain('로그인 상태 확인만 완료하지 못했습니다')
  expect(!!form()).toBe(false)
  const retry = button('로그인 상태 다시 확인').props.onClick
  await Promise.all([retry(), retry()]); await settle()
  expect(auth.refresh.mock.calls.length).toBe(2)
  expect(api.post.mock.calls.length).toBe(1)
  expect(toast.success.mock.calls.length).toBe(1)
  expect(navigate).toHaveBeenCalledWith('/dashboard')
})

it('does not navigate after a late session lookup succeeds on an unmounted password page', async () => {
  mount('change')
  const lookup = deferred()
  api.post.mockResolvedValueOnce({ ok: true })
  auth.refresh.mockReturnValueOnce(lookup.promise)
  const sending = submit()
  for (let count = 0; count < 16; count++) await Promise.resolve()
  expect(toast.success.mock.calls.length).toBe(1)
  unmount(); const updates = host.updates
  lookup.resolve(account); await sending
  expect(host.updates).toBe(updates)
  expect(navigate.mock.calls.length).toBe(0)
})

it.each(['reset', 'verify', 'change'])('preserves %s inputs after a rejected request', async kind => {
  mount(kind)
  const values = passwords().map(input => input.props.value)
  api.post.mockRejectedValueOnce({ status: 400, message: '입력 내용을 확인해주세요.' })
  await submit(); await settle()
  expect(passwords().every((input, index) => input.props.value === values[index])).toBe(true)
  expect(forgetAccountLinkToken.mock.calls.length).toBe(0)
  expect(navigate.mock.calls.length).toBe(0)
  expect(toast.success.mock.calls.length).toBe(0)
})
