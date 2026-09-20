import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Run the real provider and App with controlled hooks and deferred API responses.
// Inspect the actual Routes key: changing it unmounts every active route form.
const host = vi.hoisted(() => ({ active: null, auth: null, app: null, value: null, path: '/' }))
vi.mock('react', () => {
  const changed = (a, b) => !a || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]))
  return {
    createContext: () => ({ Provider: 'test-provider' }),
    useContext: () => host.value,
    Suspense: 'test-suspense',
    lazy: () => () => null,
    useRef(initial) {
      const instance = host.active
      return instance.cells[instance.index++] ||= { current: initial }
    },
    useState(initial) {
      const instance = host.active
      const index = instance.index++
      const cell = instance.cells[index] ||= { value: typeof initial === 'function' ? initial() : initial }
      return [cell.value, (value) => {
        const next = typeof value === 'function' ? value(cell.value) : value
        if (!Object.is(next, cell.value)) { cell.value = next; instance.dirty = true }
      }]
    },
    useCallback(callback, deps) {
      const instance = host.active
      const index = instance.index++
      if (!instance.cells[index] || changed(instance.cells[index].deps, deps)) instance.cells[index] = { callback, deps }
      return instance.cells[index].callback
    },
    useEffect(effect, deps) {
      const instance = host.active
      const index = instance.index++
      const previous = instance.cells[index]
      if (!previous || changed(previous.deps, deps)) {
        instance.cells[index] = { deps, cleanup: previous?.cleanup }
        instance.effects.push({ index, effect })
      }
    },
  }
})
vi.mock('react-router-dom', () => ({
  Routes: 'test-routes', Route: 'test-route', NavLink: 'test-nav-link', ScrollRestoration: 'test-scroll-restoration', Link: 'test-link',
  useLocation: () => ({ pathname: host.path, key: 'unchanged-location' }),
}))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn() }, getAccountSessionIdentity: vi.fn() }))
vi.mock('../src/pages/LandingPage.jsx', () => ({ default: () => null }))
vi.mock('../src/pages/LoginPage.jsx', () => ({ default: () => null }))
vi.mock('../src/components/ProtectedRoute.jsx', () => ({ default: () => null }))
vi.mock('../src/components/BrandLogo.jsx', () => ({ default: () => null }))
vi.mock('../src/components/PageViewTracker.jsx', () => ({ default: () => null }))
vi.mock('../src/components/DmLink.jsx', () => ({ default: () => null }))
vi.mock('../src/components/DemoMenu.jsx', () => ({ default: () => null }))
vi.mock('../src/components/DeferredScrollRestoration.jsx', () => ({ default: () => null }))
import { api, getAccountSessionIdentity } from '../src/api/client.js'
import { AuthProvider } from '../src/context/AuthContext.jsx'
import App from '../src/App.jsx'

const account = { id: 1, name: 'Existing account' }
const otherAccount = { id: 2, name: 'New account' }
const instance = () => ({ cells: [], index: 0, effects: [], dirty: false })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
function renderHooks(instance, component) {
  host.active = instance
  for (let count = 0; count < 20; count++) {
    instance.index = 0; instance.effects = []; instance.dirty = false
    const result = component()
    const effects = instance.effects
    for (const { index } of effects) instance.cells[index].cleanup?.()
    for (const { index, effect } of effects) instance.cells[index].cleanup = effect()
    if (!instance.dirty) return result
  }
  throw new Error('Hook state did not settle')
}
function findRoutes(element) {
  if (!element || typeof element !== 'object') return null
  if (element.type === 'test-routes') return element
  const children = element.props?.children
  for (const child of Array.isArray(children) ? children.flat() : [children]) {
    const result = findRoutes(child)
    if (result) return result
  }
  return null
}
function render() {
  host.value = renderHooks(host.auth, () => AuthProvider({ children: null })).props.value
  const routes = findRoutes(renderHooks(host.app, App))
  expect(routes).not.toBeNull() // Public routes remain present while /me is pending/offline.
  return routes.key
}
async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms)
  return render()
}
async function restore(user = account) {
  api.get.mockResolvedValueOnce({ user })
  render()
  return settle()
}

beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks()
  vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'))
  vi.stubGlobal('window', new EventTarget())
  getAccountSessionIdentity.mockReturnValue('existing-session')
  host.auth = instance(); host.app = instance(); host.value = null
  host.path = '/jobs/example/apply'
})
afterEach(() => {
  for (const instance of [host.auth, host.app]) for (const cell of instance.cells) cell?.cleanup?.()
  vi.unstubAllGlobals(); vi.useRealTimers()
})

it.each(['/jobs/example/apply', '/rooms/example/contract', '/rooms/example'])('keeps the mounted %s route key when the initial session response arrives late', async (path) => {
  host.path = path
  const lookup = deferred()
  api.get.mockReturnValueOnce(lookup.promise)
  const keyWhileTyping = render()
  expect(host.value.loading).toBe(true)
  lookup.resolve({ user: account })
  expect(await settle()).toBe(keyWhileTyping)
  expect(host.value.user).toEqual(account)
})

it('keeps the public form key through initial network failure and its later successful retry', async () => {
  api.get.mockRejectedValue(new Error('Offline'))
  const keyWhileTyping = render()
  expect(await settle(1200)).toBe(keyWhileTyping)
  expect(host.value.connectionError).toBeTruthy()
  api.get.mockResolvedValueOnce({ user: account })
  await host.value.refresh()
  expect(render()).toBe(keyWhileTyping)
  expect(host.value.connectionError).toBeNull()
})

it.each(['guest', 'unauthorized'])('does not remount public forms when initial lookup confirms %s', async (outcome) => {
  const lookup = deferred()
  api.get.mockReturnValueOnce(lookup.promise)
  const keyWhileTyping = render()
  if (outcome === 'guest') lookup.resolve({ user: null })
  else lookup.reject(Object.assign(new Error('Unauthorized'), { status: 401 }))
  expect(await settle()).toBe(keyWhileTyping)
  expect(host.value.user).toBeNull()
})

it('preserves the key for same-account refresh but resets it when the verified account changes', async () => {
  const restoredKey = await restore()
  api.get.mockResolvedValueOnce({ user: { ...account, name: 'Updated profile' } })
  await host.value.refresh()
  expect(render()).toBe(restoredKey)
  api.get.mockResolvedValueOnce({ user: otherAccount })
  await host.value.refresh()
  expect(render()).not.toBe(restoredKey)
})

it.each(['guest', 'unauthorized'])('resets account-owned form state when an established session becomes %s', async (outcome) => {
  const restoredKey = await restore()
  if (outcome === 'guest') api.get.mockResolvedValueOnce({ user: null })
  else api.get.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { status: 401 }))
  await host.value.refresh().catch(() => null)
  expect(render()).not.toBe(restoredKey)
  expect(host.value.user).toBeNull()
})

it('resets route state immediately on logout even while server revocation is pending', async () => {
  const restoredKey = await restore()
  const revocation = deferred()
  api.post.mockReturnValueOnce(revocation.promise)
  const pending = host.value.logout()
  expect(render()).not.toBe(restoredKey)
  expect(host.value.user).toBeNull()
  revocation.resolve({ ok: true })
  await pending
})

it.each(['login', 'signup', 'verifyEmail', 'startDemo'])('distinguishes explicit %s from initial session restoration', async (method) => {
  const initial = deferred()
  api.get.mockReturnValueOnce(initial.promise)
  const initialKey = render()
  const response = method === 'verifyEmail' ? {
    id: 'verified-user', email: 'verified@example.invalid', role: 'candidate', displayName: 'Verified account',
    isAdmin: false, isRecruiter: false, isDeveloper: false, mustChangePassword: false, emailVerified: true,
  } : otherAccount
  api.post.mockResolvedValueOnce(response)
  await host.value[method]()
  const authenticatedKey = render()
  expect(authenticatedKey).not.toBe(initialKey)
  initial.resolve({ user: account })
  expect(await settle()).toBe(authenticatedKey)
  expect(host.value.user).toEqual(response)
})

it('resets private route state before a different tab credential is verified', async () => {
  const restoredKey = await restore()
  const lookup = deferred()
  api.get.mockReturnValueOnce(lookup.promise)
  getAccountSessionIdentity.mockReturnValue('different-session')
  window.dispatchEvent(new Event('focus'))
  expect(render()).not.toBe(restoredKey)
  expect(host.value).toMatchObject({ user: null, loading: true })
  lookup.resolve({ user: otherAccount })
  await settle()
  expect(host.value.user).toEqual(otherAccount)
})

it('resets trial-owned route state when the trial expires', async () => {
  const key = await restore({ ...account, developerTrial: true, trialExpiresAt: new Date(Date.now() + 1000).toISOString() })
  expect(await settle(1000)).not.toBe(key)
  expect(host.value.user).toBeNull()
})
