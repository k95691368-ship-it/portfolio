import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { onRequestPost as resetPassword } from '../server/api/admin/users/[id]/reset-password.js'
import { onRequestGet as listUsers } from '../server/api/admin/users/index.js'
import { verifyPassword } from '../server/_lib/auth.js'

// Real page handlers, real reset/list handlers and real password hashing share
// an in-memory database. Only the transport/React hook host is synthetic; no
// real account, browser storage, mail or external HTTP is used.
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], setups: [], cleanups: [], dirty: false }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
const auth = vi.hoisted(() => ({ user: { id: 'admin', isAdmin: true, isDeveloper: false } }))
vi.mock('react', async original => ({
  ...await original(),
  useState(initial) {
    const index = host.index++
    const cell = host.cells[index] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; host.dirty = true }]
  },
  useRef(value) { return host.cells[host.index++] ||= { current: value } },
  useCallback(callback, deps) {
    const index = host.index++
    if (!host.cells[index] || deps.some((value, i) => !Object.is(value, host.cells[index].deps[i]))) host.cells[index] = { deps, callback }
    return host.cells[index].callback
  },
  useEffect(effect, deps) {
    const index = host.index++
    if (!host.cells[index] || deps.some((value, i) => !Object.is(value, host.cells[index].deps[i]))) {
      host.cells[index] = { deps }; host.effects.push(effect)
    }
  },
}))
vi.mock('react-router-dom', () => ({ Link: 'test-link' }))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }, downloadApiFile: vi.fn() }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => auth }))
vi.mock('../src/context/DmContext.jsx', () => ({ useDm: () => ({ openDm() {} }) }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
import { api } from '../src/api/client.js'
import AdminPage from '../src/pages/AdminPage.jsx'

const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let tree, db, env, admin, target, other, nextReset, issued, failUserReads
function render() {
  for (let count = 0; count < 20; count++) {
    host.index = 0; host.effects = []; host.dirty = false; tree = AdminPage()
    for (const effect of host.effects) {
      host.setups.push(effect)
      const cleanup = effect()
      if (typeof cleanup === 'function') host.cleanups.push(cleanup)
    }
    if (!host.dirty) return
  }
  throw new Error('Admin page did not settle')
}
async function settle() { for (let count = 0; count < 30; count++) await Promise.resolve(); render() }
const button = label => walk(tree).find(node => node.type === 'button' && text(node) === label)
const resetButton = (id = target.id) => {
  const row = walk(tree).find(node => node.type === 'tr' && text(node).includes(`${id}@example.invalid`))
  return walk(row).find(node => node.type === 'button' && text(node) === '비밀번호 재설정')
}
const banner = (id = target.id) => walk(tree).find(node => node.props?.className === 'temp-password-banner' && text(node).includes(`${id}@example.invalid`))
const displayedPassword = (id = target.id) => walk(banner(id)).find(node => node.type === 'code')?.props.children
const hasPassword = (value, id = target.id) => displayedPassword(id) === value
const copyButton = (id = target.id) => walk(banner(id)).find(node => node.type === 'button' && text(node) === '복사')
const currentPasswordMatches = async (value, id = target.id) => {
  const row = db.sql.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').get(id)
  return typeof value === 'string' && await verifyPassword(value, row.password_hash, row.password_salt)
}
async function mountWithPassword(id = target.id) {
  if (!tree) { render(); await settle() }
  await resetButton(id).props.onClick(); await settle()
  const value = displayedPassword(id)
  // Boolean assertions intentionally never print synthetic credential values.
  expect(await currentPasswordMatches(value, id)).toBe(true)
  return value
}
const uncertaintyExplained = () => text(tree).includes('목록 조회로 복구할 수 없습니다') && text(tree).includes('다시 재설정')

beforeEach(() => {
  vi.resetAllMocks()
  host.cells = []; host.index = 0; host.effects = []; host.setups = []; host.cleanups = []; host.dirty = false
  tree = null; nextReset = null; failUserReads = false; issued = new Map()
  db = sqliteApp(); env = { DB: db }
  admin = seedUser(db, 'admin', 'company', { admin: 1 })
  target = seedUser(db, 'target'); other = seedUser(db, 'other')
  auth.user = { id: admin.id, isAdmin: true, isDeveloper: false }
  vi.stubGlobal('window', { confirm: vi.fn(() => true) })
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } })
  vi.stubGlobal('localStorage', { setItem: vi.fn() })
  vi.stubGlobal('sessionStorage', { setItem: vi.fn() })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External requests are forbidden') }))
  api.get.mockImplementation(async path => {
    if (path === '/admin/users') {
      if (failUserReads) throw new Error('Synthetic list outage')
      return (await listUsers({ env, data: { user: admin } })).json()
    }
    if (path === '/admin/rooms') return { rooms: [] }
    if (path === '/admin/audit-log') return { entries: [] }
    if (path === '/admin/contracts') return { contracts: [], pendingCount: 0 }
    throw new Error('Unexpected synthetic GET')
  })
  api.post.mockImplementation(async path => {
    const id = /^\/admin\/users\/(target|other)\/reset-password$/.exec(path)?.[1]
    if (!id) throw new Error('Unexpected synthetic POST')
    const behavior = nextReset
    nextReset = null
    if (behavior?.before) throw Object.assign(new Error('Synthetic transport rejection'), { status: behavior.status })
    const response = await resetPassword({ env, data: { user: behavior?.selfDenied ? db.sql.prepare('SELECT * FROM users WHERE id = ?').get(id) : admin }, params: { id } })
    const body = await response.json()
    if (!response.ok) throw Object.assign(new Error(body.error), { status: response.status })
    issued.set(id, body.tempPassword)
    behavior?.committed?.resolve()
    if (behavior?.hold) await behavior.hold.promise
    if (behavior?.lost) throw Object.assign(new Error('Synthetic acknowledgement loss'), { status: behavior.status, code: behavior.code })
    return body
  })
})
afterEach(() => {
  db.close()
  vi.unstubAllGlobals()
})

it.each([
  ['lost network response', undefined, undefined],
  ['request timeout', 408, undefined],
  ['server failure', 500, undefined],
  ['service unavailable', 503, undefined],
  ['stale auth 401', 401, 'STALE_AUTH_RESPONSE'],
  ['stale auth 409', 409, 'STALE_AUTH_RESPONSE'],
])('removes an invalid previous password after %s and recovers only via GET', async (_label, status, code) => {
  const previous = await mountWithPassword()
  nextReset = { lost: true, status, code }
  await resetButton().props.onClick(); await settle()
  expect(await currentPasswordMatches(previous)).toBe(false)
  expect(await currentPasswordMatches(issued.get(target.id))).toBe(true)
  expect(hasPassword(previous)).toBe(false)
  expect(typeof displayedPassword() === 'undefined').toBe(true)
  expect(copyButton()).toBeUndefined()
  expect(uncertaintyExplained()).toBe(true)
  expect(resetButton().props.disabled).toBe(true)
  const writes = api.post.mock.calls.length
  await resetButton().props.onClick()
  expect(api.post.mock.calls.length).toBe(writes)
  api.get.mockClear()
  await button('사용자 다시 불러오기').props.onClick(); await settle()
  expect(api.get).toHaveBeenCalledExactlyOnceWith('/admin/users')
  expect(api.post.mock.calls.length).toBe(writes)
  expect(resetButton().props.disabled).toBe(false)
  expect(typeof displayedPassword() === 'undefined').toBe(true)
  expect(uncertaintyExplained()).toBe(true)
})

it('does not assume the old password is usable when a pre-commit network outcome is unknown', async () => {
  const previous = await mountWithPassword()
  nextReset = { before: true }
  await resetButton().props.onClick(); await settle()
  expect(await currentPasswordMatches(previous)).toBe(true)
  expect(hasPassword(previous)).toBe(false)
  expect(uncertaintyExplained()).toBe(true)
  expect(resetButton().props.disabled).toBe(true)
})

it('explains an unknown first reset without claiming GET can recover its lost value', async () => {
  render(); await settle()
  nextReset = { lost: true, status: 503 }
  await resetButton().props.onClick(); await settle()
  expect(await currentPasswordMatches(issued.get(target.id))).toBe(true)
  expect(typeof displayedPassword() === 'undefined').toBe(true)
  expect(copyButton()).toBeUndefined()
  expect(uncertaintyExplained()).toBe(true)
  expect(resetButton().props.disabled).toBe(true)
})

it.each([false, true])('keeps a confirmed replacement, including when refresh fails (%s)', async failedRefresh => {
  const previous = await mountWithPassword()
  failUserReads = failedRefresh
  await resetButton().props.onClick(); await settle()
  expect(hasPassword(previous)).toBe(false)
  expect(hasPassword(issued.get(target.id))).toBe(true)
  expect(await currentPasswordMatches(displayedPassword())).toBe(true)
  expect(copyButton()).toBeDefined()
  expect(uncertaintyExplained()).toBe(false)
  expect(toast.success).toHaveBeenCalledTimes(2)
  expect(toast.error).not.toHaveBeenCalled()
  expect(resetButton().props.disabled).toBe(failedRefresh)
  await copyButton().props.onClick()
  expect(navigator.clipboard.writeText.mock.calls.length).toBe(1)
  expect(navigator.clipboard.writeText.mock.calls[0]?.[0] === issued.get(target.id)).toBe(true)
})

it.each([400, 401, 403])('preserves a usable old value after a definite pre-write %s', async status => {
  const previous = await mountWithPassword()
  nextReset = status === 403 ? { selfDenied: true } : { before: true, status }
  await resetButton().props.onClick(); await settle()
  expect(hasPassword(previous)).toBe(true)
  expect(await currentPasswordMatches(previous)).toBe(true)
  expect(copyButton()).toBeDefined()
  expect(uncertaintyExplained()).toBe(false)
  expect(resetButton().props.disabled).toBe(false)
})

it('preserves the previous value and makes no request after confirmation cancellation', async () => {
  const previous = await mountWithPassword()
  api.post.mockClear(); api.get.mockClear(); window.confirm.mockReturnValue(false)
  await resetButton().props.onClick(); await settle()
  expect(api.post).not.toHaveBeenCalled(); expect(api.get).not.toHaveBeenCalled()
  expect(hasPassword(previous)).toBe(true)
  expect(await currentPasswordMatches(previous)).toBe(true)
})

it('withholds the target previous value and same-tick copy while preserving another target', async () => {
  const previous = await mountWithPassword()
  const otherPassword = await mountWithPassword(other.id)
  const capturedCopy = copyButton().props.onClick
  const committed = deferred(), hold = deferred()
  nextReset = { committed, hold }
  const request = resetButton().props.onClick()
  await capturedCopy()
  const copyCalls = navigator.clipboard.writeText.mock.calls.length
  await committed.promise; render()
  const pending = {
    previousValid: await currentPasswordMatches(previous),
    passwordHidden: typeof displayedPassword() === 'undefined',
    copyHidden: !copyButton(),
    instructionHidden: !text(banner()).includes('필요한 곳에 전달한 뒤 닫아주세요'),
    pendingNotice: text(banner()).includes('재설정하는 중'),
    otherPasswordKept: hasPassword(otherPassword, other.id),
    otherCopyAvailable: !!copyButton(other.id),
  }
  hold.resolve(); await request; await settle()
  expect(copyCalls).toBe(0)
  expect(pending).toEqual({ previousValid: false, passwordHidden: true, copyHidden: true, instructionHidden: true, pendingNotice: true, otherPasswordKept: true, otherCopyAvailable: true })
  expect(hasPassword(issued.get(target.id))).toBe(true)
  expect(await currentPasswordMatches(displayedPassword())).toBe(true)
})

it('invalidates only the target credential, not another account or persistent storage', async () => {
  const previous = await mountWithPassword()
  const otherPassword = await mountWithPassword(other.id)
  nextReset = { lost: true, status: 503 }
  await resetButton().props.onClick(); await settle()
  expect(hasPassword(previous)).toBe(false)
  expect(hasPassword(otherPassword, other.id)).toBe(true)
  expect(await currentPasswordMatches(otherPassword, other.id)).toBe(true)
  expect(localStorage.setItem).not.toHaveBeenCalled(); expect(sessionStorage.setItem).not.toHaveBeenCalled()
  const feedback = JSON.stringify([toast.success.mock.calls, toast.error.mock.calls, toast.info.mock.calls])
  expect([...issued.values()].some(value => feedback.includes(value))).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})

it('keeps uncertainty and write lock after failed GET recovery', async () => {
  await mountWithPassword()
  nextReset = { lost: true, status: 503 }
  await resetButton().props.onClick(); await settle()
  failUserReads = true
  const writes = api.post.mock.calls.length
  await button('사용자 다시 불러오기').props.onClick(); await settle()
  expect(resetButton().props.disabled).toBe(true)
  expect(typeof displayedPassword() === 'undefined').toBe(true)
  expect(uncertaintyExplained()).toBe(true)
  expect(api.post.mock.calls.length).toBe(writes)
})

it('obtains a new usable value only after GET recovery and explicit reset', async () => {
  const previous = await mountWithPassword()
  nextReset = { lost: true, status: 503 }
  await resetButton().props.onClick(); await settle()
  const lostPassword = issued.get(target.id)
  await button('사용자 다시 불러오기').props.onClick(); await settle()
  expect(typeof displayedPassword() === 'undefined').toBe(true)
  await resetButton().props.onClick(); await settle()
  expect(api.post).toHaveBeenCalledTimes(3)
  expect(await currentPasswordMatches(displayedPassword())).toBe(true)
  expect(await currentPasswordMatches(previous)).toBe(false)
  expect(await currentPasswordMatches(lostPassword)).toBe(false)
  expect(uncertaintyExplained()).toBe(false)
})

it('serializes same-tick resets and competing targets before another request starts', async () => {
  await mountWithPassword(); await mountWithPassword(other.id)
  const committed = deferred(), hold = deferred()
  nextReset = { committed, hold }
  api.post.mockClear()
  const submit = resetButton().props.onClick, compete = resetButton(other.id).props.onClick
  const first = submit(), duplicate = submit(), competing = compete()
  expect(api.post).toHaveBeenCalledOnce()
  await committed.promise; hold.resolve()
  await Promise.all([first, duplicate, competing]); await settle()
  expect(api.post).toHaveBeenCalledOnce()
  expect(await currentPasswordMatches(displayedPassword())).toBe(true)
})

it.each(['success', 'uncertain'])('ignores late reset %s after leaving the page', async outcome => {
  await mountWithPassword()
  const committed = deferred(), hold = deferred()
  nextReset = { committed, hold, lost: outcome === 'uncertain', status: 503 }
  const request = resetButton().props.onClick()
  await committed.promise; render()
  host.cleanups[0](); host.dirty = false
  api.get.mockClear(); toast.success.mockClear(); toast.error.mockClear(); toast.info.mockClear()
  hold.resolve(); await request
  expect(host.dirty).toBe(false)
  expect(api.get).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled(); expect(toast.info).not.toHaveBeenCalled()
})

it('does not let an older lifetime failure remove a newer revealed credential', async () => {
  await mountWithPassword()
  const committed = deferred(), hold = deferred()
  nextReset = { committed, hold, lost: true, status: 503 }
  const oldRequest = resetButton().props.onClick()
  await committed.promise; render(); host.cleanups[0]()
  // Defense-only effect replay: not evidence of a production StrictMode fault.
  host.setups[0](); await settle()
  await resetButton().props.onClick(); await settle()
  const latest = displayedPassword()
  host.dirty = false; api.get.mockClear(); toast.error.mockClear()
  hold.resolve(); await oldRequest
  expect(host.dirty).toBe(false)
  expect(api.get).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
  expect(hasPassword(latest)).toBe(true)
  expect(await currentPasswordMatches(latest)).toBe(true)
})
