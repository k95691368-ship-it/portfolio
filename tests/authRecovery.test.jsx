import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Execute the actual provider's state, effects and dependency cleanups without
// contacting the live API. Deferred responses model late session lookups.
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
vi.mock('react', () => {
  const changed = (a, b) => !a || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]))
  return {
    createContext: () => ({ Provider: 'test-provider' }),
    useContext: () => null,
    useRef(value) {
      const i = host.index++
      return host.cells[i] ||= { current: value }
    },
    useState(initial) {
      const i = host.index++
      const cell = host.cells[i] ||= { value: typeof initial === 'function' ? initial() : initial }
      return [cell.value, (value) => {
        const next = typeof value === 'function' ? value(cell.value) : value
        if (!Object.is(cell.value, next)) { cell.value = next; host.dirty = true }
      }]
    },
    useCallback(callback, deps) {
      const i = host.index++
      const previous = host.cells[i]
      if (!previous || changed(previous.deps, deps)) host.cells[i] = { deps, callback }
      return host.cells[i].callback
    },
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
vi.mock('../src/api/client.js', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  getAccountSessionIdentity: vi.fn(),
}))
import { api, getAccountSessionIdentity } from '../src/api/client.js'
import { AuthProvider } from '../src/context/AuthContext.jsx'

let output
function render() {
  for (let count = 0; count < 20; count++) {
    host.index = 0; host.dirty = false; host.effects = []
    output = AuthProvider({ children: null }).props.value
    const effects = host.effects
    for (const { i } of effects) host.cells[i].cleanup?.()
    for (const { i, effect } of effects) host.cells[i].cleanup = effect()
    if (!host.dirty) return output
  }
  throw new Error('Auth provider did not settle')
}

const defer = () => {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
const unauthorized = () => Object.assign(new Error('Unauthorized'), { status: 401 })
const oldUser = { id: 1, role: 'employer', name: 'Previous account' }
const nextUser = { id: 2, role: 'employer', name: 'Current account' }
async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms)
  return render()
}
async function restore(user = oldUser) {
  api.get.mockResolvedValueOnce({ user })
  render()
  await settle()
}
function storageChanged(key = 'portfolioSession') {
  const event = new Event('storage')
  Object.defineProperty(event, 'key', { value: key })
  window.dispatchEvent(event)
  render()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'))
  vi.resetAllMocks()
  vi.stubGlobal('window', new EventTarget())
  getAccountSessionIdentity.mockReturnValue('previous-session')
  host.cells = []; host.index = 0; host.effects = []; host.dirty = false
})
afterEach(() => {
  for (const cell of host.cells) cell?.cleanup?.()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('restores a valid session before ending the loading state', async () => {
  const lookup = defer()
  api.get.mockReturnValueOnce(lookup.promise)
  render()
  expect(output).toMatchObject({ user: null, loading: true, connectionError: null })
  lookup.resolve({ user: oldUser })
  await settle()
  expect(output).toMatchObject({ user: oldUser, loading: false, connectionError: null })
  expect(api.get).toHaveBeenCalledExactlyOnceWith('/me')
  expect(api.post).not.toHaveBeenCalled()
})

it('retries initial network failure once and preserves a recoverable connection error', async () => {
  api.get.mockRejectedValue(new Error('Internal detail should not reach the UI'))
  render()
  await settle(1199)
  expect(api.get).toHaveBeenCalledTimes(1)
  expect(output.loading).toBe(true)
  await settle(1)
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(output).toMatchObject({ user: null, loading: false })
  expect(output.connectionError).toEqual(expect.any(String))
  expect(output.connectionError).not.toContain('Internal detail')
  expect(api.post).not.toHaveBeenCalled()
})

it('restores the user and clears a connection error when manual retry succeeds', async () => {
  api.get.mockRejectedValue(new Error('Offline'))
  render()
  await settle(1200)
  expect(output.connectionError).toBeTruthy()
  api.get.mockResolvedValueOnce({ user: oldUser })
  await expect(output.refresh()).resolves.toEqual(oldUser)
  render()
  expect(output).toMatchObject({ user: oldUser, loading: false, connectionError: null })
})

it('retains an established user on refresh connection failure without leaking server details', async () => {
  await restore()
  const failure = new Error('Private upstream diagnostic')
  api.get.mockRejectedValueOnce(failure)
  await expect(output.refresh()).rejects.toBe(failure)
  render()
  expect(output.user).toEqual(oldUser)
  expect(output.connectionError).toEqual(expect.any(String))
  expect(output.connectionError).not.toContain('Private upstream diagnostic')
  expect(api.post).not.toHaveBeenCalled()
})

it('treats initial 401 as signed out, without retrying or presenting a connection error', async () => {
  api.get.mockRejectedValueOnce(unauthorized())
  render()
  await settle(1200)
  expect(output).toMatchObject({ user: null, loading: false, connectionError: null })
  expect(api.get).toHaveBeenCalledTimes(1)
})

it('clears the user and prior connection error when refresh confirms a 401', async () => {
  await restore()
  api.get.mockRejectedValueOnce(new Error('Offline'))
  await expect(output.refresh()).rejects.toThrow('Offline')
  render()
  expect(output.connectionError).toBeTruthy()
  api.get.mockRejectedValueOnce(unauthorized())
  await expect(output.refresh()).rejects.toMatchObject({ status: 401 })
  render()
  expect(output).toMatchObject({ user: null, connectionError: null })
})

it.each(['initial', 'refresh'])('ignores a late %s success after a newer login', async (kind) => {
  const lookup = defer()
  if (kind === 'refresh') await restore()
  api.get.mockReturnValueOnce(lookup.promise)
  let pending
  if (kind === 'initial') render()
  else pending = expect(output.refresh()).rejects.toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
  api.post.mockResolvedValueOnce(nextUser)
  await output.login('member@example.test', 'test-password', true)
  render()
  lookup.resolve({ user: oldUser })
  await pending
  await settle()
  expect(output).toMatchObject({ user: nextUser, loading: false, connectionError: null })
  expect(api.post).toHaveBeenCalledWith('/login', {
    email: 'member@example.test', password: 'test-password', remember: true,
  })
})

it.each(['initial', 'refresh'])('ignores a late %s unauthorized response after a newer login', async (kind) => {
  const lookup = defer()
  if (kind === 'refresh') await restore()
  api.get.mockReturnValueOnce(lookup.promise)
  let pending
  if (kind === 'initial') render()
  else pending = output.refresh().catch(() => null)
  api.post.mockResolvedValueOnce(nextUser)
  await output.login('member@example.test', 'test-password')
  render()
  lookup.reject(unauthorized())
  await pending
  await settle()
  expect(output).toMatchObject({ user: nextUser, loading: false, connectionError: null })
})

it.each(['initial', 'refresh'])('does not resurrect a logged-out user after a late %s success', async (kind) => {
  const lookup = defer()
  if (kind === 'refresh') await restore()
  api.get.mockReturnValueOnce(lookup.promise)
  let pending
  if (kind === 'initial') render()
  else pending = expect(output.refresh()).rejects.toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
  api.post.mockResolvedValueOnce({ ok: true })
  await output.logout()
  render()
  lookup.resolve({ user: oldUser })
  await pending
  await settle()
  expect(output).toMatchObject({ user: null, loading: false, connectionError: null })
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/logout', {})
})

it.each(['success', 'offline', 'unavailable'])('hides private state immediately while logout is pending, then handles %s', async (outcome) => {
  await restore()
  const pending = defer()
  api.post.mockReturnValueOnce(pending.promise)
  const completion = output.logout().catch((error) => error)
  render()
  expect(output).toMatchObject({ user: null, loading: false, connectionError: null })
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/logout', {})

  const error = Object.assign(new Error('Private upstream detail'), { status: outcome === 'unavailable' ? 503 : 0 })
  if (outcome === 'success') pending.resolve({ ok: true })
  else pending.reject(error)
  expect(await completion).toEqual(outcome === 'success' ? { ok: true } : error)
  render()
  expect(output).toMatchObject({ user: null, loading: false, connectionError: null })
})

it.each(['initial', 'refresh'])('ignores a late %s lookup before a slow logout request has finished', async (kind) => {
  const lookup = defer()
  const revocation = defer()
  if (kind === 'refresh') await restore()
  api.get.mockReturnValueOnce(lookup.promise)
  let refreshResult
  if (kind === 'initial') render()
  else refreshResult = output.refresh().catch((error) => error)
  api.post.mockReturnValueOnce(revocation.promise)
  const completion = output.logout()
  render()
  lookup.resolve({ user: oldUser })
  if (refreshResult) expect(await refreshResult).toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
  await settle()
  expect(output).toMatchObject({ user: null, loading: false, connectionError: null })
  revocation.resolve({ ok: true })
  await completion
})

it.each(['success', 'failure'])('does not clear a newer login when an earlier logout ends with %s', async (outcome) => {
  await restore()
  const revocation = defer()
  api.post.mockReturnValueOnce(revocation.promise)
  const completion = output.logout().catch((error) => error)
  api.post.mockImplementationOnce(async () => {
    getAccountSessionIdentity.mockReturnValue('next-session')
    return nextUser
  })
  await output.login('member@example.test', 'test-password', true)
  render()
  if (outcome === 'success') revocation.resolve({ ok: true })
  else revocation.reject(new Error('Offline'))
  await completion
  render()
  expect(output).toMatchObject({ user: nextUser, loading: false, connectionError: null })
  window.dispatchEvent(new Event('focus'))
  render()
  expect(output.user).toEqual(nextUser)
  expect(api.get).toHaveBeenCalledTimes(1)
})

it.each(['portfolioSession', null])('clears the current user immediately when another tab removes storage using key %j', async (key) => {
  await restore()
  getAccountSessionIdentity.mockReturnValue(null)
  storageChanged(key)
  expect(output).toMatchObject({ user: null, loading: false, connectionError: null })
  expect(api.get).toHaveBeenCalledTimes(1)
  expect(api.post).not.toHaveBeenCalled()
})

it('does not revive an account when its refresh finishes after logout in another tab', async () => {
  await restore()
  const lookup = defer()
  api.get.mockReturnValueOnce(lookup.promise)
  const result = output.refresh().catch((error) => error)
  getAccountSessionIdentity.mockReturnValue(null)
  storageChanged()
  lookup.resolve({ user: oldUser })
  expect(await result).toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
  render()
  expect(output).toMatchObject({ user: null, loading: false, connectionError: null })
})

it.each(['storage', 'focus'])('hides the previous account until a different stored token is verified after %s', async (eventType) => {
  await restore()
  const lookup = defer()
  api.get.mockReturnValueOnce(lookup.promise)
  getAccountSessionIdentity.mockReturnValue('next-session')
  if (eventType === 'storage') storageChanged()
  else { window.dispatchEvent(new Event('focus')); render() }
  expect(output).toMatchObject({ user: null, loading: true, connectionError: null })
  expect(api.get).toHaveBeenCalledTimes(2)
  lookup.resolve({ user: nextUser })
  await settle()
  expect(output).toMatchObject({ user: nextUser, loading: false, connectionError: null })
})

it('keeps the previous private user hidden when another tab account cannot be verified', async () => {
  await restore()
  api.get.mockRejectedValueOnce(new Error('Private upstream detail'))
  getAccountSessionIdentity.mockReturnValue('next-session')
  storageChanged()
  await settle()
  expect(output).toMatchObject({ user: null, loading: false })
  expect(output.connectionError).toEqual(expect.any(String))
  expect(output.connectionError).not.toContain('Private upstream detail')
})

it('ignores same-token expiry renewal and unrelated storage changes', async () => {
  await restore()
  storageChanged() // Only the expiry metadata changed; identity remains the same.
  window.dispatchEvent(new Event('focus'))
  getAccountSessionIdentity.mockReturnValue('next-session')
  storageChanged('unrelated-preference')
  expect(output).toMatchObject({ user: oldUser, loading: false, connectionError: null })
  expect(api.get).toHaveBeenCalledTimes(1)
})

it('removes storage and focus listeners when the provider unmounts', async () => {
  const add = vi.spyOn(window, 'addEventListener')
  const remove = vi.spyOn(window, 'removeEventListener')
  await restore()
  const handlers = add.mock.calls.filter(([type]) => type === 'storage' || type === 'focus')
  expect(handlers.map(([type]) => type).sort()).toEqual(['focus', 'storage'])
  for (const cell of host.cells) {
    cell?.cleanup?.()
    if (cell) cell.cleanup = undefined
  }
  for (const [type, handler] of handlers) expect(remove).toHaveBeenCalledWith(type, handler)
  getAccountSessionIdentity.mockReturnValue('next-session')
  storageChanged()
  window.dispatchEvent(new Event('focus'))
  expect(api.get).toHaveBeenCalledTimes(1)
})

it('continues expiring a developer trial at its server-provided deadline', async () => {
  await restore({
    ...oldUser, developerTrial: true,
    trialExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  })
  await settle(60 * 60 * 1000 - 1)
  expect(output.user?.developerTrial).toBe(true)
  await settle(1)
  expect(output.user).toBeNull()
  expect(api.post).not.toHaveBeenCalled()
})

it('cleans up an old developer-trial expiry when a normal account logs in', async () => {
  await restore({
    ...oldUser, developerTrial: true,
    trialExpiresAt: new Date(Date.now() + 1000).toISOString(),
  })
  api.post.mockResolvedValueOnce(nextUser)
  await output.login('member@example.test', 'test-password')
  render()
  await settle(1000)
  expect(output.user).toEqual(nextUser)
})

it('does not treat a pending email-verification response as a logged-in user', async () => {
  await restore(null)
  const pending = { verificationRequired: true, email: 'member@example.test' }
  api.post.mockResolvedValueOnce(pending)
  expect(await output.signup({ email: pending.email })).toEqual(pending)
  render()
  expect(output).toMatchObject({ user: null, loading: false })
})

it('updates auth only after email and password proof have succeeded', async () => {
  await restore(null)
  api.post.mockResolvedValueOnce(verifiedUser)
  await output.verifyEmail('synthetic-link-proof', 'test-password')
  render()
  expect(output.user).toMatchObject({ id: verifiedUser.id, emailVerified: true })
  expect(api.post).toHaveBeenCalledWith('/account/verify-email', { token: 'synthetic-link-proof', password: 'test-password' })
})

const verifiedUser = {
  id: 'verified-account', email: 'verified@example.test', role: 'candidate',
  displayName: 'Verified member', isAdmin: false, isRecruiter: false, isDeveloper: false,
  mustChangePassword: false, emailVerified: true,
}

it.each([
  ['null', null], ['empty', {}], ['array', []],
  ['unverified', { ...verifiedUser, emailVerified: false }],
  ['missing id', { ...verifiedUser, id: undefined }],
  ['object id', { ...verifiedUser, id: {} }],
  ['blank id', { ...verifiedUser, id: ' ' }],
  ['invalid email', { ...verifiedUser, email: 'invalid' }],
  ['email control character', { ...verifiedUser, email: 'verified@example.test\n' }],
  ['unknown role', { ...verifiedUser, role: 'administrator' }],
  ['blank name', { ...verifiedUser, displayName: ' ' }],
  ['missing password-change flag', { ...verifiedUser, mustChangePassword: undefined }],
  ['string admin flag', { ...verifiedUser, isAdmin: 'false' }],
  ['missing recruiter flag', { ...verifiedUser, isRecruiter: undefined }],
  ['numeric developer flag', { ...verifiedUser, isDeveloper: 1 }],
])('does not publish a %s email verification response as a session', async (_label, response) => {
  await restore(null)
  const complete = vi.fn()
  const previousEpoch = output.sessionEpoch
  api.post.mockResolvedValueOnce(response)
  await expect(output.verifyEmail('synthetic-link-proof', 'test-password', {
    isCurrent: () => true, onVerified: complete,
  })).rejects.toMatchObject({ code: 'INVALID_VERIFIED_ACCOUNT' })
  render()
  expect(output).toMatchObject({ user: null, sessionEpoch: previousEpoch })
  expect(complete).not.toHaveBeenCalled()
})

it('finishes the verified page callback before publishing a session that remounts routes', async () => {
  await restore(null)
  const order = []
  const previousEpoch = output.sessionEpoch
  api.post.mockResolvedValueOnce(verifiedUser)
  const complete = vi.fn((account) => {
    render()
    expect(output).toMatchObject({ user: null, sessionEpoch: previousEpoch })
    expect(account).toEqual(verifiedUser)
    order.push('proof-cleared-and-navigated')
  })
  await output.verifyEmail('synthetic-link-proof', 'test-password', {
    isCurrent: () => true, onVerified: complete,
  })
  render()
  if (output.user === verifiedUser) order.push('session-published')
  expect(order).toEqual(['proof-cleared-and-navigated', 'session-published'])
  expect(complete).toHaveBeenCalledTimes(1)
  expect(output.sessionEpoch).toBe(previousEpoch + 1)
})

it('does not publish a verification session when the page has left during the request', async () => {
  await restore(null)
  const request = defer()
  let current = true
  const complete = vi.fn()
  api.post.mockReturnValueOnce(request.promise)
  const pending = output.verifyEmail('synthetic-link-proof', 'test-password', {
    isCurrent: () => current, onVerified: complete,
  }).catch((error) => error)
  current = false
  request.resolve(verifiedUser)
  expect(await pending).toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
  render()
  expect(output.user).toBeNull()
  expect(complete).not.toHaveBeenCalled()
})

it('does not publish a verification session when the page callback fails', async () => {
  await restore(null)
  const failure = new Error('Local completion unavailable')
  api.post.mockResolvedValueOnce(verifiedUser)
  const complete = vi.fn(() => { throw failure })
  await expect(output.verifyEmail('synthetic-link-proof', 'test-password', {
    isCurrent: () => true, onVerified: complete,
  })).rejects.toBe(failure)
  render()
  expect(output.user).toBeNull()
  expect(complete).toHaveBeenCalledTimes(1)
})

it('does not send a verification request when its caller has already left', async () => {
  await restore(null)
  const complete = vi.fn()
  await expect(output.verifyEmail('synthetic-link-proof', 'test-password', {
    isCurrent: () => false, onVerified: complete,
  })).rejects.toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
  expect(api.post).not.toHaveBeenCalled()
  expect(complete).not.toHaveBeenCalled()
})

it('passes the caller abort signal through to the API and ignores a late successful response after abort', async () => {
  await restore(null)
  const request = defer()
  const controller = new AbortController()
  const complete = vi.fn()
  api.post.mockReturnValueOnce(request.promise)
  const pending = output.verifyEmail('synthetic-link-proof', 'test-password', {
    signal: controller.signal, isCurrent: () => true, onVerified: complete,
  }).catch((error) => error)
  expect(api.post.mock.lastCall[2]).toEqual({ signal: controller.signal })
  controller.abort()
  request.resolve(verifiedUser)
  expect(await pending).toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
  render()
  expect(output.user).toBeNull()
  expect(complete).not.toHaveBeenCalled()
})

it.each(['login', 'logout', 'refresh'])('does not overwrite a newer %s when verification finishes late', async (operation) => {
  await restore(null)
  const request = defer()
  const complete = vi.fn()
  api.post.mockReturnValueOnce(request.promise)
  const pending = output.verifyEmail('synthetic-link-proof', 'test-password', {
    isCurrent: () => true, onVerified: complete,
  }).catch((error) => error)
  if (operation === 'login') {
    api.post.mockResolvedValueOnce(nextUser)
    await output.login('member@example.test', 'test-password')
  } else if (operation === 'logout') {
    api.post.mockResolvedValueOnce({ ok: true })
    await output.logout()
  } else {
    api.get.mockResolvedValueOnce({ user: nextUser })
    await output.refresh()
  }
  render()
  request.resolve(verifiedUser)
  expect(await pending).toMatchObject({ code: 'STALE_AUTH_RESPONSE' })
  render()
  expect(output.user).toEqual(operation === 'logout' ? null : nextUser)
  expect(complete).not.toHaveBeenCalled()
})
