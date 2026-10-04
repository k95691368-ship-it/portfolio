import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sqliteApp } from './helpers/sqliteApp.js'

// Real parent/pending handlers, recovery SQL, and client session storage. Only
// React hook scheduling, browser storage, and the mail/HTTP transports are synthetic.
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
const auth = vi.hoisted(() => ({ current: null }))
const toast = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('react', async original => ({
  ...await original(),
  useState(initial) {
    const cell = host.cells[host.index++] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; host.dirty = true }]
  },
  useRef(initial) { return host.cells[host.index++] ||= { current: initial } },
  useEffect(effect, deps) {
    const index = host.index++, previous = host.cells[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      const cell = { deps, cleanup: previous?.cleanup }
      host.cells[index] = cell
      host.effects.push(() => { cell.cleanup?.(); cell.cleanup = effect() })
    }
  },
}))
vi.mock('react-router-dom', () => ({ Link: 'test-link', Navigate: 'test-navigate', useLocation: () => ({ search: '' }) }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => auth.current }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
vi.mock('../server/_lib/gmail.js', () => ({ isGmailConfigured: () => true }))
vi.mock('../server/_lib/emailOutbox.js', () => ({ sendTrackedEmail: vi.fn(async () => ({ id: 'synthetic-mail' })) }))

import SignupPage from '../src/pages/SignupPage.jsx'
import LoginPage from '../src/pages/LoginPage.jsx'
import EmailVerificationPending from '../src/components/EmailVerificationPending.jsx'
import { api, getAccountSessionIdentity } from '../src/api/client.js'
import { sendTrackedEmail } from '../server/_lib/emailOutbox.js'
import { signupAccount, resendVerification, correctPendingEmail, verifyAccountEmail } from '../server/_lib/accountRecovery.js'
import { onRequestPost as login } from '../server/api/login.js'

const KEY = 'portfolioSession'
const profile = { email: 'synthetic-member@example.invalid', password: 'synthetic-password-only', displayName: 'Synthetic member', role: 'candidate' }
const handlers = {
  '/signup': signupAccount, '/login': login,
  '/account/resend-verification': resendVerification,
  '/account/correct-email': correctPendingEmail,
  '/account/verify-email': verifyAccountEmail,
}
const storage = () => {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) }
}
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const inputs = (tree, type) => walk(tree).filter(node => node.type === 'input' && node.props.type === type)
const form = tree => walk(tree).find(node => node.type === 'form')
const submit = tree => form(tree).props.onSubmit({ preventDefault() {} })
let db, requests

function render(Component, props = {}) {
  for (let i = 0; i < 12; i++) {
    host.index = 0; host.effects = []; host.dirty = false
    const tree = Component(props)
    for (const effect of host.effects) effect()
    if (!host.dirty) return tree
  }
  throw new Error('Account form did not settle')
}
function freshHost() {
  for (const cell of host.cells) cell.cleanup?.()
  host.cells = []; host.index = 0; host.effects = []; host.dirty = false
}
async function enterPending(entry, remember) {
  if (entry === 'login') await api.post('/signup', { ...profile, remember })
  const Parent = entry === 'signup' ? SignupPage : LoginPage
  let tree = render(Parent)
  inputs(tree, 'email')[0].props.onChange({ target: { value: profile.email } })
  inputs(tree, 'password')[0].props.onChange({ target: { value: profile.password } })
  if (entry === 'signup') inputs(tree, undefined)[0].props.onChange({ target: { value: profile.displayName } })
  inputs(tree, 'checkbox')[0].props.onChange({ target: { checked: remember } })
  tree = render(Parent)
  await submit(tree)
  tree = render(Parent)
  expect(tree.type).toBe(EmailVerificationPending)
  expect(requests.find(request => request.path === `/${entry}`).body.remember).toBe(remember)
  const props = tree.props
  freshHost()
  return { props, tree: render(EmailVerificationPending, props) }
}
async function requestAgain(pending, action = 'resend') {
  inputs(pending.tree, 'password')[0].props.onChange({ target: { value: profile.password } })
  if (action === 'correct') inputs(pending.tree, 'email')[1].props.onChange({ target: { value: 'corrected@example.invalid' } })
  const tree = render(EmailVerificationPending, pending.props)
  await form(tree).props.onSubmit({ preventDefault() {}, nativeEvent: { submitter: { value: action } } })
  const after = render(EmailVerificationPending, pending.props)
  expect(inputs(after, 'password')[0].props.value).toBe('')
  expect(walk(after).some(node => node.props?.role === 'status')).toBe(true)
  return requests.findLast(request => request.path === `/account/${action === 'correct' ? 'correct-email' : 'resend-verification'}`).body
}
async function expectVerifiedSession(remember) {
  // The generated link belongs only to the in-memory mail fixture; never print it.
  const token = sendTrackedEmail.mock.calls.at(-1)[1].text.match(/#token=([A-Za-z0-9_-]{43})/)[1]
  const result = await api.post('/account/verify-email', { token, password: profile.password })
  const expiresAt = db.sql.prepare('SELECT expires_at FROM sessions').get().expires_at
  const outcome = {
    persistent: result.sessionPersistent,
    hours: Math.round((Date.parse(expiresAt) - Date.now()) / 3600000),
    storedLocally: !!localStorage.getItem(KEY),
    storedInTab: !!sessionStorage.getItem(KEY),
    availableInTab: !!getAccountSessionIdentity(),
  }
  // This models a discarded tab store, not every browser's tab-restore policy.
  vi.stubGlobal('sessionStorage', storage())
  outcome.availableAfterTabDiscard = !!getAccountSessionIdentity()
  expect(outcome).toEqual({
    persistent: remember, hours: remember ? 720 : 12,
    storedLocally: remember, storedInTab: !remember,
    availableInTab: true, availableAfterTabDiscard: remember,
  })
}

beforeEach(() => {
  vi.clearAllMocks(); freshHost()
  db = sqliteApp(); requests = []
  vi.stubGlobal('localStorage', storage())
  vi.stubGlobal('sessionStorage', storage())
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const path = new URL(url, 'https://synthetic.invalid').pathname.replace(/^.*\/api(?=\/)/, '')
    const handler = handlers[path]
    if (!handler) throw new Error('Unexpected transport; no external HTTP allowed')
    const body = JSON.parse(options.body)
    requests.push({ path, body })
    return handler({ env: { DB: db }, request: new Request(`https://synthetic.invalid${path}`, options) })
  }))
  auth.current = {
    user: null, loading: false, connectionError: null,
    signup: payload => api.post('/signup', payload),
    login: (email, password, remember) => api.post('/login', { email, password, remember }),
  }
})
afterEach(() => { freshHost(); db.close(); vi.unstubAllGlobals() })

describe('remember choice survives the parent-to-verification transition', () => {
  it.each(['signup', 'login'].flatMap(entry => [false, true].map(remember => [entry, remember])))('%s keeps remember=%s through resend, verification and client storage', async (entry, remember) => {
    const pending = await enterPending(entry, remember)
    const sent = await requestAgain(pending)
    await expectVerifiedSession(remember)
    expect(inputs(pending.tree, 'checkbox')[0].props.checked).toBe(remember)
    expect(sent.remember).toBe(remember)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([false, true])('keeps remember=%s through address correction without changing its proof rules', async remember => {
    const pending = await enterPending('signup', remember)
    const sent = await requestAgain(pending, 'correct')
    expect(db.sql.prepare('SELECT email FROM users').get().email).toBe('corrected@example.invalid')
    await expectVerifiedSession(remember)
    expect(inputs(pending.tree, 'checkbox')[0].props.checked).toBe(remember)
    expect(sent.remember).toBe(remember)
  })

  it('keeps the original nonpersistent signup link nonpersistent without a resend', async () => {
    await enterPending('signup', false)
    await expectVerifiedSession(false)
    expect(requests.map(request => request.path)).toEqual(['/signup', '/account/verify-email'])
  })

  it.each([false, true])('allows the user to reselect remember after entering with %s', async initial => {
    const pending = await enterPending('signup', initial)
    expect(inputs(pending.tree, 'checkbox')[0].props.checked).toBe(initial)
    inputs(pending.tree, 'checkbox')[0].props.onChange({ target: { checked: !initial } })
    pending.tree = render(EmailVerificationPending, pending.props)
    expect((await requestAgain(pending)).remember).toBe(!initial)
    await expectVerifiedSession(!initial)
  })

  it('keeps the existing standalone pending-page default enabled', () => {
    expect(inputs(render(EmailVerificationPending), 'checkbox')[0].props.checked).toBe(true)
  })

  it.each([false, true])('uses initialRemember=%s only on initialization and preserves later choices', initial => {
    let tree = render(EmailVerificationPending, { initialRemember: initial })
    expect(inputs(tree, 'checkbox')[0].props.checked).toBe(initial)
    tree = render(EmailVerificationPending, { initialRemember: !initial })
    expect(inputs(tree, 'checkbox')[0].props.checked).toBe(initial)
    inputs(tree, 'checkbox')[0].props.onChange({ target: { checked: !initial } })
    tree = render(EmailVerificationPending, { initialRemember: initial })
    expect(inputs(tree, 'checkbox')[0].props.checked).toBe(!initial)
  })
})
