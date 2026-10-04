import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'
import { createSession, getSessionUser, hashPassword, verifyPassword } from '../server/_lib/auth.js'
import { onRequestPost as changePassword } from '../server/api/change-password.js'
import { onRequestPost as login } from '../server/api/login.js'
import { onRequestGet as me } from '../server/api/me.js'

// Exercise the actual JSX, API client, password/session handlers and SQLite
// schema. Only the hook host and transport are synthetic; no browser storage,
// external HTTP, mail or real credentials are used.
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false, updates: 0 }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
const navigate = vi.hoisted(() => vi.fn())
const auth = vi.hoisted(() => ({ user: null, refresh: vi.fn() }))
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
      host.cells[index] = { deps, cleanup: previous?.cleanup }
      host.effects.push(() => { previous?.cleanup?.(); host.cells[index].cleanup = effect() })
    }
  },
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => auth }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
import { api, getAccountSessionIdentity } from '../src/api/client.js'
import ChangePasswordPage from '../src/pages/ChangePasswordPage.jsx'

const OLD_PASSWORD = 'synthetic-old-password'
const NEW_PASSWORD = 'synthetic-new-password'
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const deferred = () => {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}
const storage = () => {
  const rows = new Map()
  return {
    getItem: vi.fn(key => rows.get(key) ?? null),
    setItem: vi.fn((key, value) => rows.set(key, String(value))),
    removeItem: vi.fn(key => rows.delete(key)),
  }
}
let tree, db, nextChange, originalSession, requests
function render() {
  for (let count = 0; count < 12; count++) {
    host.index = 0; host.effects = []; host.dirty = false; tree = ChangePasswordPage()
    for (const effect of host.effects) effect()
    if (!host.dirty) return
  }
  throw new Error('Password page did not settle')
}
function unmount() { for (const cell of host.cells) cell.cleanup?.() }
const form = () => walk(tree).find(node => node.type === 'form')
const inputs = () => walk(tree).filter(node => node.type === 'input')
const submitButton = () => walk(tree).find(node => node.type === 'button' && node.props.type === 'submit')
const loginLink = () => walk(tree).find(node => node.type === 'a' && node.props.href === '/login')
const uncertainty = () => text(tree).includes('변경됐을 수 있습니다') && text(tree).includes('새 비밀번호로 로그인해')
const submit = () => form().props.onSubmit({ preventDefault() {} })
const writeCount = () => requests.filter(request => request.path === '/change-password').length
const readCount = () => requests.filter(request => request.method === 'GET').length
const saved = () => db.sql.prepare('SELECT * FROM users WHERE id = ?').get('candidate')
const matches = async password => { const row = saved(); return verifyPassword(password, row.password_hash, row.password_salt) }
const oldSessionValid = async () => !!await getSessionUser(db, new Request('https://local-test.invalid', {
  headers: { 'X-App-Authorization': `Bearer ${originalSession.token}` },
}))
function fill(currentPassword = OLD_PASSWORD) {
  for (const [index, input] of inputs().entries()) input.props.onChange({ target: { value: index === 0 ? currentPassword : NEW_PASSWORD } })
  render()
}

beforeEach(async () => {
  vi.resetAllMocks()
  host.cells = []; host.index = 0; host.effects = []; host.dirty = false; host.updates = 0
  nextChange = null; requests = []
  db = sqliteApp(); seedUser(db, 'candidate')
  const { hash, salt } = await hashPassword(OLD_PASSWORD)
  await db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 1 WHERE id = ?')
    .bind(hash, salt, 'candidate').run()
  originalSession = await createSession(db, 'candidate', { persistent: false })
  vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage())
  sessionStorage.setItem('portfolioSession', JSON.stringify({ token: originalSession.token, expiresAt: originalSession.expiresAt }))
  localStorage.setItem.mockClear(); sessionStorage.setItem.mockClear()
  auth.user = { id: 'candidate', role: 'candidate', mustChangePassword: true }
  auth.refresh.mockImplementation(async () => (await api.get('/me')).user)
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const path = new URL(url, 'https://local-test.invalid').pathname.replace(/^\/api/, '')
    const method = options.method || 'GET'
    requests.push({ path, method })
    const request = new Request(`https://local-test.invalid/api${path}`, { method, headers: options.headers, body: options.body })
    const user = await getSessionUser(db, request)
    if (path === '/change-password') {
      const behavior = nextChange || {}
      nextChange = null
      if (behavior.before) {
        if (behavior.status) return Response.json({ error: 'Synthetic pre-write rejection' }, { status: behavior.status })
        throw new TypeError('Synthetic pre-write network failure')
      }
      const handlerDb = behavior.sessionRace ? {
        ...db,
        async batch(statements) {
          // Simulate another credential update between this handler's commit
          // and createSession's real expected-hash INSERT. Do not stub its result.
          behavior.passwordCommitted = await matches(NEW_PASSWORD)
          behavior.oldSessionRevoked = !await oldSessionValid()
          const replacement = await hashPassword('synthetic-concurrent-password')
          await db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
            .bind(replacement.hash, replacement.salt, 'candidate').run()
          return db.batch(statements)
        },
      } : db
      const response = await changePassword({ request, env: { DB: handlerDb }, data: { user } })
      behavior.committed?.resolve()
      if (behavior.hold) await behavior.hold.promise
      if (behavior.stall) return new Promise(() => {})
      if (behavior.bodyStall) {
        Object.defineProperty(response, 'json', { value: () => new Promise(() => {}) })
        return response
      }
      if (behavior.stale) sessionStorage.setItem('portfolioSession', JSON.stringify({ token: 'synthetic-new-account' }))
      if (behavior.lost) throw new TypeError('Synthetic acknowledgement loss')
      if (behavior.status) return Response.json({ error: 'Synthetic response failure' }, { status: behavior.status })
      if (behavior.malformed === 'json') return new Response('{', { status: 200 })
      if (behavior.malformed) return Response.json(behavior.malformed)
      return response
    }
    if (path === '/me') return me({ data: { user } })
    if (path === '/login') return login({ request, env: { DB: db } })
    throw new Error('External/unexpected HTTP is forbidden in this fixture')
  }))
  render(); fill()
})
afterEach(() => { unmount(); db.close(); vi.useRealTimers(); vi.unstubAllGlobals() })

it.each([
  ['transport loss', { lost: true }],
  ['server 500', { status: 500 }],
  ['server 503', { status: 503 }],
  ['stale authentication', { stale: true }],
  ['malformed JSON', { malformed: 'json' }],
  ['empty success', { malformed: {} }],
  ['unconfirmed success', { malformed: { ok: false } }],
])('keeps an editable form and persistent uncertainty after committed %s', async (_label, behavior) => {
  nextChange = behavior
  await submit(); render()
  expect(await matches(OLD_PASSWORD)).toBe(false)
  expect(await matches(NEW_PASSWORD)).toBe(true)
  expect(saved().must_change_password).toBe(0)
  expect(await oldSessionValid()).toBe(false)
  expect(uncertainty()).toBe(true)
  expect(loginLink()).toBeDefined()
  expect(loginLink().props.href).toBe('/login')
  expect(loginLink().props.onClick).toBeUndefined()
  expect(form()).toBeDefined(); expect(submitButton().props.disabled).toBe(false)
  expect(inputs().every(input => !input.props.readOnly)).toBe(true)
  expect(inputs().every((input, index) => input.props.value === (index === 0 ? OLD_PASSWORD : NEW_PASSWORD))).toBe(true)
  expect(writeCount()).toBe(1); expect(readCount()).toBe(0)
  expect(auth.refresh).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled()
  expect(text(tree)).not.toContain('비밀번호를 변경했습니다')
  if (!behavior.stale) {
    expect(localStorage.setItem).not.toHaveBeenCalled(); expect(sessionStorage.setItem).not.toHaveBeenCalled()
  }
})

it.each(['headers', 'body'])('shows uncertainty for an actual client 408 %s deadline after commit, without replay or GET', async phase => {
  vi.useFakeTimers()
  const committed = deferred()
  nextChange = { committed, stall: phase === 'headers', bodyStall: phase === 'body' }
  const sending = submit()
  await committed.promise
  await vi.advanceTimersByTimeAsync(120_000)
  await sending; render()
  expect(toast.error.mock.calls[0]?.[0]).toContain('응답 시간이 초과')
  expect(await matches(NEW_PASSWORD)).toBe(true); expect(await oldSessionValid()).toBe(false)
  expect(uncertainty()).toBe(true); expect(loginLink()).toBeDefined()
  expect(writeCount()).toBe(1); expect(readCount()).toBe(0)
  expect(auth.refresh).not.toHaveBeenCalled(); expect(submitButton().props.disabled).toBe(false)
})

it('explains an actual handler 409 after committing and revoking the old session, without claiming success', async () => {
  const behavior = { sessionRace: true }
  nextChange = behavior
  await submit(); render()
  expect(behavior.passwordCommitted).toBe(true); expect(behavior.oldSessionRevoked).toBe(true)
  expect(await matches('synthetic-concurrent-password')).toBe(true)
  expect(toast.error.mock.calls[0]?.[0]).toContain('로그인 정보가 변경되었습니다')
  expect(uncertainty()).toBe(true); expect(loginLink()).toBeDefined()
  expect(form()).toBeDefined(); expect(submitButton().props.disabled).toBe(false)
  expect(toast.success).not.toHaveBeenCalled(); expect(auth.refresh).not.toHaveBeenCalled()
  expect(writeCount()).toBe(1); expect(readCount()).toBe(0)
})

it('does not claim a change or lock the form when the transport failed before committing', async () => {
  nextChange = { before: true }
  await submit(); render()
  expect(await matches(OLD_PASSWORD)).toBe(true); expect(await oldSessionValid()).toBe(true)
  expect(uncertainty()).toBe(true); expect(loginLink()).toBeDefined()
  expect(toast.success).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled()
  expect(writeCount()).toBe(1); expect(readCount()).toBe(0)
  inputs()[0].props.onChange({ target: { value: 'editable-after-uncertainty' } }); render()
  expect(inputs()[0].props.value === 'editable-after-uncertainty').toBe(true)
  fill(); await submit(); render()
  expect(writeCount()).toBe(2); expect(readCount()).toBe(1)
  expect(auth.refresh).toHaveBeenCalledOnce(); expect(toast.success).toHaveBeenCalledOnce()
  expect(uncertainty()).toBe(false); expect(form()).toBeUndefined()
})

it.each([400, 401, 403])('does not add uncertainty for a definite pre-write %s rejection', async status => {
  if (status === 401) fill('synthetic-wrong-password')
  else nextChange = { before: true, status }
  await submit(); render()
  expect(await matches(OLD_PASSWORD)).toBe(true); expect(await oldSessionValid()).toBe(true)
  expect(uncertainty()).toBe(false); expect(loginLink()).toBeUndefined()
  expect(form()).toBeDefined(); expect(submitButton().props.disabled).toBe(false)
  expect(writeCount()).toBe(1); expect(readCount()).toBe(0)
  expect(toast.success).not.toHaveBeenCalled(); expect(auth.refresh).not.toHaveBeenCalled()
})

it('preserves an earlier uncertainty notice when an explicit retry returns 401', async () => {
  nextChange = { lost: true }
  await submit(); render()
  expect(uncertainty()).toBe(true)
  await submit(); render()
  expect(toast.error.mock.calls.at(-1)?.[0]).toContain('로그인이 필요합니다')
  expect(uncertainty()).toBe(true); expect(loginLink()).toBeDefined()
  expect(form()).toBeDefined(); expect(submitButton().props.disabled).toBe(false)
  expect(writeCount()).toBe(2); expect(readCount()).toBe(0)
})

it.each([400, 403, 429])('does not erase earlier uncertainty when a later explicit retry is rejected with %s', async status => {
  nextChange = { lost: true }
  await submit(); render()
  nextChange = { before: true, status }
  await submit(); render()
  expect(uncertainty()).toBe(true); expect(loginLink()).toBeDefined()
  expect(form()).toBeDefined(); expect(submitButton().props.disabled).toBe(false)
  expect(writeCount()).toBe(2); expect(readCount()).toBe(0)
  expect(toast.success).not.toHaveBeenCalled(); expect(auth.refresh).not.toHaveBeenCalled()
})

it('keeps the normal success, input cleanup and single session refresh unchanged', async () => {
  await submit(); render()
  expect(await matches(NEW_PASSWORD)).toBe(true); expect(await oldSessionValid()).toBe(false)
  expect(form()).toBeUndefined(); expect(uncertainty()).toBe(false)
  expect(text(tree)).toContain('비밀번호를 변경했습니다')
  expect(loginLink()).toBeDefined()
  expect(host.cells.slice(0, 3).every(cell => cell.value === '')).toBe(true)
  expect(auth.refresh).toHaveBeenCalledOnce(); expect(toast.success).toHaveBeenCalledOnce()
  expect(navigate).toHaveBeenCalledExactlyOnceWith('/dashboard')
  expect(writeCount()).toBe(1); expect(readCount()).toBe(1)
  expect(getAccountSessionIdentity() === originalSession.token).toBe(false)
})

it('still separates confirmed success from a failed subsequent session refresh', async () => {
  auth.refresh.mockRejectedValueOnce(new Error('Synthetic session lookup failure'))
  await submit(); render()
  expect(form()).toBeUndefined(); expect(uncertainty()).toBe(false)
  expect(text(tree)).toContain('비밀번호는 변경되었습니다')
  expect(loginLink()).toBeDefined(); expect(toast.success).toHaveBeenCalledOnce()
  expect(writeCount()).toBe(1); expect(readCount()).toBe(0)
})

it.each([false, true])('deduplicates same-tick requests without automatic replay (uncertain: %s)', async uncertain => {
  const committed = deferred(), hold = deferred()
  nextChange = { committed, hold, lost: uncertain }
  const handler = form().props.onSubmit
  const first = handler({ preventDefault() {} }), duplicate = handler({ preventDefault() {} })
  await committed.promise; render()
  expect(writeCount()).toBe(1); expect(submitButton().props.disabled).toBe(true)
  hold.resolve(); await Promise.all([first, duplicate]); render()
  expect(writeCount()).toBe(1); expect(uncertainty()).toBe(uncertain)
  expect(readCount()).toBe(uncertain ? 0 : 1)
})

it.each([false, true])('ignores late response after leaving the page (uncertain: %s)', async uncertain => {
  const committed = deferred(), hold = deferred()
  nextChange = { committed, hold, lost: uncertain }
  const sending = submit()
  await committed.promise; render(); unmount()
  const updates = host.updates
  toast.error.mockClear(); toast.success.mockClear()
  hold.resolve(); await sending
  expect(host.updates).toBe(updates)
  expect(toast.error).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled()
  expect(auth.refresh).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled()
  expect(writeCount()).toBe(1); expect(readCount()).toBe(0)
})

it('does not publish an old lifetime uncertainty in a freshly mounted password form', async () => {
  const committed = deferred(), hold = deferred()
  nextChange = { committed, hold, lost: true }
  const sending = submit()
  await committed.promise; render(); unmount()
  host.cells = []; render(); fill()
  const updates = host.updates
  toast.error.mockClear(); toast.success.mockClear()
  hold.resolve(); await sending; render()
  expect(host.updates).toBe(updates)
  expect(uncertainty()).toBe(false); expect(loginLink()).toBeUndefined()
  expect(form()).toBeDefined(); expect(submitButton().props.disabled).toBe(false)
  expect(toast.error).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled()
  expect(writeCount()).toBe(1); expect(readCount()).toBe(0)
})

it('keeps the existing reload and new-password login alternative valid without an automatic login', async () => {
  nextChange = { lost: true }
  await submit(); render()
  expect(uncertainty()).toBe(true); expect(requests.some(request => request.path === '/login')).toBe(false)
  const state = await api.get('/me')
  expect(state.user).toBeNull(); expect(getAccountSessionIdentity()).toBeNull()
  const recovered = await api.post('/login', { email: saved().email, password: NEW_PASSWORD, remember: false })
  expect(recovered.id).toBe('candidate'); expect(recovered.mustChangePassword).toBe(false)
  expect(writeCount()).toBe(1)
})
