import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], cleanups: [], dirty: false, updates: 0 }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('react', async original => ({
  ...await original(),
  useState(initial) {
    const index = host.index++
    const cell = host.cells[index] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; host.dirty = true; host.updates += 1 }]
  },
  useRef(value) { return host.cells[host.index++] ||= { current: value } },
  useMemo(factory, deps) {
    const index = host.index++
    if (!host.cells[index] || deps.some((value, i) => !Object.is(value, host.cells[index].deps[i]))) host.cells[index] = { deps, value: factory() }
    return host.cells[index].value
  },
  useEffect(effect, deps) {
    const index = host.index++
    if (!host.cells[index] || deps.some((value, i) => !Object.is(value, host.cells[index].deps[i]))) {
      host.cells[index] = { deps, effect }; host.effects.push(effect)
    }
  },
}))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))

import { api } from '../src/api/client.js'
import RoomInviteEmailForm from '../src/components/RoomInviteEmailForm.jsx'
import FinalOfferEmailForm from '../src/components/FinalOfferEmailForm.jsx'

let tree, Component, props
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const form = () => walk(tree).find(node => node.type === 'form')
const textarea = () => walk(tree).find(node => node.type === 'textarea')
const submitButton = () => walk(tree).find(node => node.type === 'button' && node.props.type === 'submit')
const button = label => walk(tree).find(node => node.type === 'button' && text(node) === label)
const submit = () => form().props.onSubmit({ preventDefault() {} })
function render() {
  for (let count = 0; count < 12; count++) {
    host.index = 0; host.effects = []; host.dirty = false; tree = Component(props)
    for (const effect of host.effects) { const cleanup = effect(); if (typeof cleanup === 'function') host.cleanups.push(cleanup) }
    if (!host.dirty) return tree
  }
  throw new Error('render loop')
}
async function settle() { for (let count = 0; count < 20; count++) await Promise.resolve(); render() }
function unmount() { for (const cleanup of host.cleanups.splice(0)) cleanup() }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const delivery = { status: 'sent', recipientEmailMasked: 'f***@example.invalid', subject: 'Synthetic subject', sentAt: '2026-09-19T00:00:00.000Z', attemptCount: 1 }
const success = kind => kind === 'invite' ? { ok: true, recipientEmailMasked: delivery.recipientEmailMasked } : { ok: true, delivery }
function mount(kind, initial = {}) {
  Component = kind === 'invite' ? RoomInviteEmailForm : FinalOfferEmailForm
  props = { roomId: 'room', candidateName: 'Synthetic candidate', companyName: 'Synthetic company',
    initial: { candidate: { displayName: 'Synthetic candidate', emailMasked: 'f***@example.invalid' }, emailConfigured: true, delivery: null, ...initial } }
  render()
}
beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.cleanups = []; host.dirty = false; host.updates = 0
  vi.stubGlobal('window', { confirm: vi.fn(() => true) })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No external email or network allowed') }))
})
afterEach(() => { unmount(); vi.unstubAllGlobals() })

it.each(['invite', 'offer'])('prevents same-tick duplicate %s submissions', async kind => {
  mount(kind)
  const request = deferred()
  api.post.mockReturnValue(request.promise)
  const first = submit()
  const second = submit()
  expect(api.post).toHaveBeenCalledOnce()
  expect(window.confirm).toHaveBeenCalledOnce()
  request.resolve(success(kind)); await Promise.all([first, second]); await settle()
})

it.each(['invite', 'offer'])('does not claim %s delivery for malformed success responses', async kind => {
  mount(kind)
  api.post.mockResolvedValueOnce({})
  await submit(); await settle()
  expect(toast.success).not.toHaveBeenCalled()
  expect(submitButton().props.disabled).toBe(true)
  expect(text(tree)).toContain('발송 결과')
})

it('preserves edits made while the final offer is being sent and labels them unsent', async () => {
  mount('offer')
  const request = deferred()
  api.post.mockReturnValueOnce(request.promise)
  const sending = submit(); render()
  const submittedBody = api.post.mock.calls[0][1].bodyText
  textarea().props.onChange({ target: { value: 'Synthetic newer unsent draft' } }); render()
  request.resolve(success('offer')); await sending; await settle()
  expect(api.post.mock.calls[0][1].bodyText).toBe(submittedBody)
  expect(textarea()?.props.value).toBe('Synthetic newer unsent draft')
  expect(text(tree)).toContain('전송되지 않았습니다')
  expect(submitButton().props.disabled).toBe(true)
})

it('does not label an uncertain final-offer response as successful delivery', async () => {
  mount('offer')
  api.post.mockResolvedValueOnce({ ok: true, delivery: { ...delivery, status: 'unknown' } })
  await submit(); await settle()
  expect(toast.success).not.toHaveBeenCalled()
  expect(submitButton().props.disabled).toBe(true)
})

it('keeps the accepted final-offer receipt locked before React rerenders', async () => {
  mount('offer')
  const handler = form().props.onSubmit
  api.post.mockResolvedValue(success('offer'))
  await handler({ preventDefault() {} })
  await handler({ preventDefault() {} })
  expect(api.post).toHaveBeenCalledOnce()
})

it('recovers an accepted final offer after a lost POST response using GET only', async () => {
  mount('offer')
  api.post.mockRejectedValueOnce({ status: 502 })
  await submit(); await settle()
  expect(submitButton().props.disabled).toBe(true)
  const handler = form().props.onSubmit
  api.get.mockResolvedValueOnce({ delivery })
  await button('발송 결과 확인').props.onClick()
  // A captured submit callback must also see the confirmed delivery immediately.
  await handler({ preventDefault() {} })
  await settle()
  expect(api.post).toHaveBeenCalledOnce()
  expect(api.get).toHaveBeenCalledWith('/rooms/room/final-offer-email')
  expect(toast.success).not.toHaveBeenCalled()
  expect(text(tree)).toContain('접수했습니다')
  expect(text(tree)).toContain('수신함 도착을 확인한 상태는 아닙니다')
})

it('keeps an older failed delivery from suggesting a resend after an uncertain POST', async () => {
  mount('offer', { delivery: { ...delivery, status: 'failed', attemptCount: 1 } })
  api.post.mockRejectedValueOnce({ status: 502 })
  await submit(); await settle()
  api.get.mockResolvedValueOnce({ delivery: { ...delivery, status: 'failed', attemptCount: 1 } })
  await button('발송 결과 확인').props.onClick(); await settle()
  expect(submitButton().props.disabled).toBe(true)
  expect(text(tree)).not.toContain('내용을 확인하고 다시 시도해주세요')
  await submit()
  expect(api.post).toHaveBeenCalledOnce()
})

it('preserves newer invitation text without claiming that text was sent', async () => {
  mount('invite')
  const request = deferred()
  api.post.mockReturnValueOnce(request.promise)
  const sending = submit(); render()
  const submitted = { ...api.post.mock.calls[0][1] }
  textarea().props.onChange({ target: { value: 'Synthetic later invitation draft' } }); render()
  request.resolve(success('invite')); await sending; await settle()
  expect(api.post.mock.calls[0][1]).toEqual(submitted)
  expect(textarea().props.value).toBe('Synthetic later invitation draft')
  expect(text(tree)).toContain('이후 입력한 내용은 전송되지 않았습니다')
  expect(text(tree)).toContain('수신함 도착을 확인한 상태는 아닙니다')
})

it.each(['invite', 'offer'])('keeps %s uncertain after a timeout without automatically resending', async kind => {
  mount(kind)
  const original = textarea().props.value
  api.post.mockRejectedValueOnce({ status: 408, message: 'Synthetic internal error detail' })
  await submit(); await settle()
  expect(submitButton().props.disabled).toBe(true)
  expect(textarea().props.value).toBe(original)
  expect(text(tree)).not.toContain('Synthetic internal error detail')
  await submit(); await settle()
  expect(api.post).toHaveBeenCalledOnce()
  expect(api.get).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
})

it.each(['invite', 'offer'])('allows an explicit corrected %s request after a known rejection', async kind => {
  mount(kind)
  api.post.mockRejectedValueOnce({ status: 400 }).mockResolvedValueOnce(success(kind))
  await submit(); await settle()
  expect(submitButton().props.disabled).toBe(false)
  expect(toast.success).not.toHaveBeenCalled()
  expect(api.post).toHaveBeenCalledOnce()
  textarea().props.onChange({ target: { value: 'Synthetic corrected body' } }); render()
  await submit(); await settle()
  expect(api.post).toHaveBeenCalledTimes(2)
  expect(api.post.mock.calls[1][1].bodyText).toBe('Synthetic corrected body')
  expect(toast.success).toHaveBeenCalledOnce()
})

it.each([
  ['invite', 'resolve'], ['invite', 'reject'], ['offer', 'resolve'], ['offer', 'reject'],
])('ignores late %s POST %s after unmount', async (kind, result) => {
  mount(kind)
  const request = deferred()
  api.post.mockReturnValueOnce(request.promise)
  const sending = submit(); render()
  unmount()
  const updates = host.updates
  if (result === 'resolve') request.resolve(success(kind))
  else request.reject({ status: 502 })
  await sending
  expect(host.updates).toBe(updates)
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
})

it.each(['malformed', 'network'])('retries only the final-offer status GET after %s failure', async result => {
  mount('offer')
  api.post.mockRejectedValueOnce({ status: 502 })
  await submit(); await settle()
  if (result === 'malformed') api.get.mockResolvedValueOnce({})
  else api.get.mockRejectedValueOnce({ status: 503 })
  api.get.mockResolvedValueOnce({ delivery })
  await button('발송 결과 확인').props.onClick(); await settle()
  expect(submitButton().props.disabled).toBe(true)
  expect(text(tree)).toContain('이메일은 다시 보내지 않습니다')
  expect(api.post).toHaveBeenCalledOnce()
  expect(toast.success).not.toHaveBeenCalled()
  await button('발송 결과 확인').props.onClick(); await settle()
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(api.post).toHaveBeenCalledOnce()
  expect(text(tree)).toContain('접수했습니다')
})

it('does not unlock an uncertain final offer when its record has not appeared yet', async () => {
  mount('offer')
  api.post.mockRejectedValueOnce(new Error('Synthetic transport loss'))
  await submit(); await settle()
  api.get.mockResolvedValueOnce({ delivery: null })
  await button('발송 결과 확인').props.onClick(); await settle()
  expect(submitButton().props.disabled).toBe(true)
  expect(text(tree)).toContain('아직 확인되지 않았습니다')
  await submit()
  expect(api.post).toHaveBeenCalledOnce()
})

it('unlocks only an explicitly failed newer attempt without automatically sending it again', async () => {
  mount('offer', { delivery: { ...delivery, status: 'failed', attemptCount: 1 } })
  api.post.mockRejectedValueOnce({ status: 502 })
  await submit(); await settle()
  api.get.mockResolvedValueOnce({ delivery: { ...delivery, status: 'failed', attemptCount: 2 } })
  await button('발송 결과 확인').props.onClick(); await settle()
  expect(submitButton().props.disabled).toBe(false)
  expect(text(tree)).toContain('직접 다시 요청할 수 있습니다')
  expect(api.post).toHaveBeenCalledOnce()
  expect(toast.success).not.toHaveBeenCalled()
})

it('deduplicates status checks and ignores their late result after unmount', async () => {
  mount('offer', { delivery: { ...delivery, status: 'unknown' } })
  const request = deferred()
  api.get.mockReturnValueOnce(request.promise)
  const check = button('발송 결과 확인').props.onClick
  const first = check(), second = check()
  expect(api.get).toHaveBeenCalledOnce()
  expect(api.post).not.toHaveBeenCalled()
  unmount()
  const updates = host.updates
  request.resolve({ delivery }); await Promise.all([first, second])
  expect(host.updates).toBe(updates)
  expect(toast.info).not.toHaveBeenCalled()
})

it.each(['invite', 'offer'])('does not send %s when email configuration is unavailable', async kind => {
  mount(kind, { emailConfigured: false })
  expect(submitButton().props.disabled).toBe(true)
  await submit()
  expect(api.post).not.toHaveBeenCalled()
  expect(window.confirm).not.toHaveBeenCalled()
})
