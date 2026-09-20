import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Execute route decisions and effects without a browser or production requests.
// This complements browser checks; clearing sessionStorage below only simulates
// a new browser session and does not claim to exercise a real browser restart.
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
const route = vi.hoisted(() => ({ search: '', partnerId: 'partner-1' }))
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal()
  const changed = (previous, next) => !previous || !next ||
    previous.length !== next.length || previous.some((value, i) => !Object.is(value, next[i]))
  return {
    ...actual,
    useState(initial) {
      const i = host.index++
      const cell = host.cells[i] ||= { value: typeof initial === 'function' ? initial() : initial }
      return [cell.value, (value) => {
        const next = typeof value === 'function' ? value(cell.value) : value
        if (!Object.is(next, cell.value)) { cell.value = next; host.dirty = true }
      }]
    },
    useRef(value) { const i = host.index++; return host.cells[i] ||= { current: value } },
    useEffect(effect, deps) {
      const i = host.index++
      const previous = host.cells[i]
      if (!previous || changed(previous.deps, deps)) {
        host.cells[i] = { deps, cleanup: previous?.cleanup }
        host.effects.push({ i, effect })
      }
    },
  }
})
vi.mock('react-router-dom', () => ({
  Navigate: vi.fn(), Outlet: vi.fn(), Link: vi.fn(),
  useLocation: () => ({ search: route.search }),
  useParams: () => ({ partnerId: route.partnerId }),
  useNavigate: vi.fn(() => vi.fn()),
}))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: vi.fn() }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: vi.fn() }))
vi.mock('../src/context/DmContext.jsx', () => ({ useDm: vi.fn() }))

import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../src/context/AuthContext.jsx'
import { useToast } from '../src/context/ToastContext.jsx'
import { useDm } from '../src/context/DmContext.jsx'
import ProtectedRoute from '../src/components/ProtectedRoute.jsx'
import SessionRecovery from '../src/components/SessionRecovery.jsx'
import DmLink from '../src/components/DmLink.jsx'
import LoginPage from '../src/pages/LoginPage.jsx'

const storage = () => {
  const rows = new Map()
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, String(value)),
    removeItem: (key) => rows.delete(key),
  }
}
const defer = () => {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const nodes = (node) => !node || typeof node !== 'object' ? [] :
  [node, ...[].concat(node.props?.children || []).flatMap(nodes)]
const find = (tree, type) => nodes(tree).find((node) => node.type === type)
const text = (tree) => typeof tree === 'string' ? tree :
  tree?.props ? [].concat(tree.props.children || []).map(text).join('') : ''

function render(Component, props = {}) {
  for (let count = 0; count < 20; count++) {
    host.index = 0; host.effects = []; host.dirty = false
    const result = Component(props)
    const effects = host.effects
    for (const { i } of effects) host.cells[i].cleanup?.()
    for (const { i, effect } of effects) host.cells[i].cleanup = effect()
    if (!host.dirty) return result
  }
  throw new Error('Route hooks did not settle')
}

let auth, toast
beforeEach(() => {
  vi.clearAllMocks()
  host.cells = []; host.index = 0; host.effects = []; host.dirty = false
  route.search = ''; route.partnerId = 'partner-1'
  auth = { user: null, loading: false, connectionError: null, login: vi.fn(), refresh: vi.fn() }
  toast = { error: vi.fn() }
  useAuth.mockImplementation(() => auth)
  useToast.mockReturnValue(toast)
  useDm.mockReturnValue({ openDm: vi.fn() })
  vi.stubGlobal('window', { location: { assign: vi.fn(), replace: vi.fn() } })
  vi.stubGlobal('localStorage', storage())
  vi.stubGlobal('sessionStorage', storage())
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  for (const cell of host.cells) cell?.cleanup?.()
  vi.unstubAllGlobals()
})

describe('session restoration gates', () => {
  it.each([ProtectedRoute, LoginPage, DmLink])('%s waits for restoration without showing login or redirecting', (Component) => {
    auth.loading = true
    const result = render(Component)
    expect(find(result, 'form')).toBeUndefined()
    expect(find(result, Navigate)).toBeUndefined()
    expect(window.location.replace).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([ProtectedRoute, LoginPage, DmLink])('%s offers recovery instead of treating a network error as logout', (Component) => {
    auth.connectionError = '서버에 연결하지 못했습니다.'
    const result = render(Component)
    expect(result.type).toBe(SessionRecovery)
    expect(find(result, 'form')).toBeUndefined()
    expect(find(result, Navigate)).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([ProtectedRoute, DmLink])('%s redirects genuinely logged-out users to login', (Component) => {
    const result = render(Component)
    expect(result.type).toBe(Navigate)
    expect(result.props).toMatchObject({ to: '/login', replace: true })
  })

  it('shows a login form only after the session check confirms no user', () => {
    expect(find(render(LoginPage), 'form')).toBeDefined()
  })

  it.each([true, false])('submits the selected remember=%s option with accessible persistence guidance', async (remember) => {
    let result = render(LoginPage)
    const checkbox = nodes(result).find((node) => node.props?.type === 'checkbox')
    expect(checkbox.props.checked).toBe(true)
    expect(checkbox.props['aria-describedby']).toBe('remember-login-hint')
    expect(text(result)).toContain('기본 30일')
    expect(text(result)).toContain('공용 기기')
    checkbox.props.onChange({ target: { checked: remember } })
    result = render(LoginPage)
    await find(result, 'form').props.onSubmit({ preventDefault() {} })
    expect(auth.login).toHaveBeenCalledExactlyOnceWith('', '', remember)
  })
})

describe('already authenticated login page', () => {
  beforeEach(() => { auth.user = { id: 'user-1', role: 'company' } })

  it('replaces the login page with the dashboard', () => {
    const result = render(LoginPage)
    expect(result.type).toBe(Navigate)
    expect(result.props).toMatchObject({ to: '/dashboard', replace: true })
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('does not honor an external next destination', () => {
    route.search = '?next=https%3A%2F%2Foutside.example%2F'
    expect(render(LoginPage).props.to).toBe('/dashboard')
    expect(window.location.replace).not.toHaveBeenCalled()
  })

  it('loads a fresh document for the allowlisted interview destination', () => {
    const destination = '/rooms/room-1/interview/interview-1'
    route.search = `?next=${encodeURIComponent(destination)}`
    const result = render(LoginPage)
    expect(window.location.replace).toHaveBeenCalledExactlyOnceWith(destination)
    expect(find(result, Navigate)).toBeUndefined()
    expect(find(result, 'form')).toBeUndefined()
  })

  it('requires a password change before following an interview link', () => {
    auth.user.mustChangePassword = true
    route.search = '?next=%2Frooms%2Froom-1%2Finterview%2Finterview-1'
    expect(render(LoginPage).props.to).toBe('/change-password')
    expect(window.location.replace).not.toHaveBeenCalled()
  })
})

describe('protected permissions remain enforced', () => {
  beforeEach(() => { auth.user = { id: 'user-1', role: 'candidate' } })

  it('renders the protected child for an authenticated permitted user', () => {
    expect(render(ProtectedRoute).type).toBe(Outlet)
  })

  it.each([{ requireAdmin: true }, { requireRecruiter: true }, { role: 'company' }])(
    'does not grant additional privileges after restoring a session (%j)', (props) => {
      const result = render(ProtectedRoute, props)
      expect(result.type).toBe(Navigate)
      expect(result.props.to).toBe('/dashboard')
      expect(toast.error).toHaveBeenCalledOnce()
    }
  )

  it('preserves mandatory password changes and only permits the designated change route', () => {
    auth.user.mustChangePassword = true
    expect(render(ProtectedRoute).props.to).toBe('/change-password')
    expect(render(ProtectedRoute, { allowMustChangePassword: true }).type).toBe(Outlet)
  })

  it('does not open a DM before a mandatory password change', () => {
    auth.user.mustChangePassword = true
    expect(render(DmLink).props.to).toBe('/change-password')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('session recovery retry', () => {
  beforeEach(() => { auth.connectionError = '서버에 연결하지 못했습니다.' })

  it('uses the auth refresh operation and prevents duplicate retries while pending', async () => {
    const pending = defer()
    auth.refresh.mockReturnValue(pending.promise)
    const button = find(render(SessionRecovery), 'button')
    expect(text(button)).toContain('다시 시도')
    const first = button.props.onClick()
    const duplicate = button.props.onClick()
    expect(auth.refresh).toHaveBeenCalledOnce()
    const busy = find(render(SessionRecovery), 'button')
    expect(busy.props.disabled).toBe(true)
    expect(text(busy)).toContain('확인 중')
    pending.resolve({ id: 'user-1' })
    await Promise.all([first, duplicate])
    expect(find(render(SessionRecovery), 'button').props.disabled).toBe(false)
  })

  it('allows another retry after a connection failure without exposing a login form', async () => {
    auth.refresh.mockRejectedValue(new Error('still offline'))
    const first = find(render(SessionRecovery), 'button')
    await expect(first.props.onClick()).resolves.toBeUndefined()
    const result = render(SessionRecovery)
    expect(find(result, 'button').props.disabled).toBe(false)
    expect(find(result, 'form')).toBeUndefined()
    expect(find(result, Navigate)).toBeUndefined()
    expect(text(result)).toContain(auth.connectionError)
  })
})

describe('remembered browser session storage', () => {
  const key = 'portfolioSession'
  const loginResponse = (persistent) => ({
    id: 'user-1', sessionToken: 'test-session-token', sessionPersistent: persistent,
    sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  })
  const client = async () => {
    vi.resetModules()
    return (await import('../src/api/client.js')).api
  }

  it.each([true, false])('respects remember=%s across client reload and new sessionStorage', async (remember) => {
    const api = await client()
    fetch.mockResolvedValueOnce(Response.json(loginResponse(remember)))
    await api.post('/login', { email: 'user@example.test', password: 'test-only', remember })
    expect(localStorage.getItem(key) !== null).toBe(remember)
    expect(sessionStorage.getItem(key) !== null).toBe(!remember)
    vi.stubGlobal('sessionStorage', storage())
    const reopened = await client()
    fetch.mockResolvedValueOnce(Response.json({ user: remember ? { id: 'user-1' } : null }))
    await reopened.get('/me')
    expect(fetch.mock.lastCall[1].headers['X-App-Authorization'])
      .toBe(remember ? 'Bearer test-session-token' : undefined)
  })

  it('keeps remembered credentials through a temporary server failure for the next retry', async () => {
    localStorage.setItem(key, JSON.stringify({ token: 'test-session-token' }))
    const api = await client()
    fetch.mockResolvedValueOnce(Response.json({ error: 'temporarily unavailable' }, { status: 503 }))
    await expect(api.get('/me')).rejects.toMatchObject({ status: 503 })
    expect(JSON.parse(localStorage.getItem(key)).token).toBe('test-session-token')
    fetch.mockResolvedValueOnce(Response.json({ user: { id: 'user-1' } }))
    await api.get('/me')
    expect(fetch.mock.lastCall[1].headers['X-App-Authorization']).toBe('Bearer test-session-token')
  })

  it('does not send expired remembered credentials', async () => {
    localStorage.setItem(key, JSON.stringify({ token: 'expired', expiresAt: new Date(Date.now() - 1000).toISOString() }))
    fetch.mockResolvedValueOnce(Response.json({ user: null }))
    await (await client()).get('/me')
    expect(fetch.mock.lastCall[1].headers['X-App-Authorization']).toBeUndefined()
    expect(localStorage.getItem(key)).toBeNull()
  })
})
