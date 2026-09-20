import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Exercise the real components with controlled promises; no live account,
// credential, email, browser, or external API is used by these tests.
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false, updates: 0 }))
vi.mock('react', async original => {
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]))
  return {
    ...await original(),
    useState(initial) {
      const index = host.index++
      const cell = host.cells[index] ||= { value: typeof initial === 'function' ? initial() : initial }
      return [cell.value, value => {
        const next = typeof value === 'function' ? value(cell.value) : value
        if (!Object.is(next, cell.value)) { cell.value = next; host.dirty = true; host.updates += 1 }
      }]
    },
    useRef(initial) { return host.cells[host.index++] ||= { current: initial } },
    useCallback(callback, deps) {
      const index = host.index++
      if (!host.cells[index] || changed(host.cells[index].deps, deps)) host.cells[index] = { callback, deps }
      return host.cells[index].callback
    },
    useEffect(effect, deps) {
      const index = host.index++, previous = host.cells[index]
      if (!previous || changed(previous.deps, deps)) {
        host.cells[index] = { effect, deps, cleanup: previous?.cleanup }
        host.effects.push(index)
      }
    },
  }
})
vi.mock('react-router-dom', () => ({ Link: 'test-link' }))
vi.mock('../src/api/client.js', () => ({ api: { post: vi.fn() } }))
import { api } from '../src/api/client.js'
import ForgotPasswordPage from '../src/pages/ForgotPasswordPage.jsx'
import EmailVerificationPending from '../src/components/EmailVerificationPending.jsx'

let Component, props, tree
const walk = node => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? ''
  : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const fields = type => walk(tree).filter(node => node.type === 'input' && node.props.type === type)
const form = () => walk(tree).find(node => node.type === 'form')
const status = () => walk(tree).filter(node => node.props?.role === 'status').map(text).join(' ')
const alert = () => walk(tree).filter(node => node.props?.role === 'alert').map(text).join(' ')
const event = action => ({ preventDefault() {}, nativeEvent: { submitter: { value: action } } })
const accepted = { ok: true, message: '입력한 정보로 진행할 수 있으면 이메일을 보냅니다. 메일이 없으면 주소와 스팸함을 확인한 뒤 다시 요청해주세요.' }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function render() {
  for (let count = 0; count < 15; count++) {
    host.index = 0; host.effects = []; host.dirty = false
    tree = Component(props)
    for (const index of host.effects) host.cells[index].cleanup?.()
    for (const index of host.effects) host.cells[index].cleanup = host.cells[index].effect()
    if (!host.dirty) return tree
  }
  throw new Error('Unsettled account request component')
}
async function flush() { for (let count = 0; count < 20; count++) await Promise.resolve() }
async function settle() { await flush(); render() }
function unmount() { for (const cell of host.cells) cell?.cleanup?.() }
function mount(action) {
  Component = action === 'forgot' ? ForgotPasswordPage : EmailVerificationPending
  props = { email: 'original@example.invalid' }
  render()
  fields('email')[0].props.onChange({ target: { value: 'original@example.invalid' } })
  if (action !== 'forgot') fields('password')[0].props.onChange({ target: { value: 'x'.repeat(12) } })
  if (action === 'correct') fields('email')[1].props.onChange({ target: { value: 'corrected@example.invalid' } })
  render()
}
beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.dirty = false; host.updates = 0
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live account and email calls are forbidden') }))
})
afterEach(() => { unmount(); vi.unstubAllGlobals() })

it.each(['forgot', 'resend', 'correct'])('%s accepts the actual generic server response without claiming account existence', async action => {
  mount(action)
  api.post.mockResolvedValueOnce(accepted)
  await form().props.onSubmit(event(action)); await settle()
  expect(status()).toContain(accepted.message)
  expect(alert()).toBe('')
  expect(api.post).toHaveBeenCalledOnce()
  expect(api.post.mock.calls[0][0]).toBe(`/account/${action === 'forgot' ? 'forgot-password' : action === 'correct' ? 'correct-email' : 'resend-verification'}`)
  if (action !== 'forgot') expect(fields('password')[0].props.value).toBe('')
})

it.each(['forgot', 'resend', 'correct'])('%s blocks duplicate same-tick form submissions', async action => {
  mount(action)
  const pending = deferred()
  api.post.mockReturnValue(pending.promise)
  const submit = form().props.onSubmit
  const first = submit(event(action)), second = submit(event(action))
  pending.resolve(accepted); await Promise.all([first, second]); await settle()
  expect(api.post).toHaveBeenCalledOnce()
})

it.each(['resend', 'correct'])('%s does not erase a different password entered during its pending request', async action => {
  mount(action)
  const pending = deferred()
  api.post.mockReturnValueOnce(pending.promise)
  const writing = form().props.onSubmit(event(action)); render()
  const editable = !fields('password')[0].props.disabled
  if (editable) { fields('password')[0].props.onChange({ target: { value: 'y'.repeat(13) } }); render() }
  pending.resolve(accepted); await writing; await settle()
  expect(fields('password')[0].props.value).toBe(editable ? 'y'.repeat(13) : '')
})

it.each(['forgot', 'resend', 'correct'])('%s does not attach older request feedback to an edited email', async action => {
  mount(action)
  const pending = deferred()
  api.post.mockReturnValueOnce(pending.promise)
  const writing = form().props.onSubmit(event(action)); render()
  const index = action === 'correct' ? 1 : 0
  const editable = !fields('email')[index].props.disabled
  if (editable) { fields('email')[index].props.onChange({ target: { value: 'next@example.invalid' } }); render() }
  pending.resolve(accepted); await writing; await settle()
  // Either temporarily lock the address or keep old feedback tied to its
  // submitted address. A generic status beside a different address is ambiguous.
  if (editable) {
    expect(fields('email')[index].props.value).toBe('next@example.invalid')
    expect(!status() || status().includes(action === 'correct' ? 'corrected@example.invalid' : 'original@example.invalid')).toBe(true)
  } else expect(status()).toContain(accepted.message)
})

it('forgot clears the previous accepted notice before a later failed request', async () => {
  mount('forgot')
  api.post.mockResolvedValueOnce(accepted)
  await form().props.onSubmit(event('forgot')); await settle()
  fields('email')[0].props.onChange({ target: { value: 'next@example.invalid' } }); render()
  api.post.mockRejectedValueOnce(Object.assign(new Error('이메일 발송을 사용할 수 없습니다.'), { status: 503 }))
  await form().props.onSubmit(event('forgot')); await settle()
  expect(alert()).toContain('이메일 발송을 사용할 수 없습니다')
  expect(status()).toBe('')
})

it.each(['forgot', 'resend', 'correct'].flatMap(action => [null, {}, { ok: true, message: '' }].map(response => [action, response])))('%s reports an unconfirmed outcome rather than silence or a raw exception for malformed 2xx %j', async (action, response) => {
  mount(action)
  api.post.mockResolvedValueOnce(response)
  await form().props.onSubmit(event(action)); await settle()
  expect(status()).toBe('')
  expect(alert()).not.toBe('')
  expect(alert()).not.toMatch(/Cannot read|TypeError|undefined|null/)
  if (action !== 'forgot') expect(fields('password')[0].props.value).toBe('x'.repeat(12))
  expect(api.post).toHaveBeenCalledOnce()
})

it.each(['forgot', 'resend', 'correct'].flatMap(action => ['success', 'failure'].map(outcome => [action, outcome])))('%s ignores a late %s after unmount', async (action, outcome) => {
  mount(action)
  const pending = deferred()
  api.post.mockReturnValueOnce(pending.promise)
  const writing = form().props.onSubmit(event(action)); render(); unmount()
  const updates = host.updates
  if (outcome === 'success') pending.resolve(accepted)
  else pending.reject(new Error('지연된 요청 오류'))
  await writing; await flush()
  expect(host.updates).toBe(updates)
})
