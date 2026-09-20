import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [] }))
const navigate = vi.hoisted(() => vi.fn())
vi.mock('react', async (original) => ({
  ...await original(),
  useState(initial) {
    const index = host.index++
    const cell = host.cells[index] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, (value) => { cell.value = typeof value === 'function' ? value(cell.value) : value }]
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
vi.mock('react-router-dom', () => ({ Link: 'test-link', useNavigate: () => navigate }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: vi.fn() }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }))
vi.mock('../src/api/client.js', () => ({ api: { post: vi.fn() } }))
import { useAuth } from '../src/context/AuthContext.jsx'
import { api } from '../src/api/client.js'
import SignupPage from '../src/pages/SignupPage.jsx'
import EmailVerificationPending from '../src/components/EmailVerificationPending.jsx'
import VerifyEmailPage from '../src/pages/VerifyEmailPage.jsx'
import ForgotPasswordPage from '../src/pages/ForgotPasswordPage.jsx'
import ResetPasswordPage from '../src/pages/ResetPasswordPage.jsx'
import { readAccountLinkToken, forgetAccountLinkToken } from '../src/lib/accountLinkToken.js'

const walk = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const field = (tree, type) => walk(tree).filter((node) => node.type === 'input' && node.props.type === type)
const form = (tree) => walk(tree).find((node) => node.type === 'form')
const render = (Component, props = {}) => {
  host.index = 0; host.effects = []
  const tree = Component(props)
  for (const effect of host.effects) effect()
  return tree
}
const submit = { preventDefault: vi.fn() }
let auth
beforeEach(() => {
  vi.clearAllMocks(); host.cells = []; host.index = 0; host.effects = []
  forgetAccountLinkToken()
  auth = { signup: vi.fn(), verifyEmail: vi.fn() }
  useAuth.mockReturnValue(auth)
  const location = { pathname: '/verify-email', hash: '', replace: vi.fn() }
  vi.stubGlobal('window', { location, history: { state: null, replaceState: vi.fn((_state, _title, path) => { location.pathname = path; location.hash = '' }) } })
})
afterEach(() => { for (const cell of host.cells) cell.cleanup?.(); vi.unstubAllGlobals() })

it('clears a link fragment before requests and keeps its proof only in memory across StrictMode initialization', () => {
  const token = 'a'.repeat(43)
  window.location.hash = `#token=${token}`
  expect(readAccountLinkToken()).toBe(token)
  expect(window.history.replaceState).toHaveBeenCalledWith(null, '', '/verify-email')
  expect(window.location.hash).toBe('')
  expect(readAccountLinkToken()).toBe(token)
  expect(api.post).not.toHaveBeenCalled()
  forgetAccountLinkToken()
  expect(readAccountLinkToken()).toBe('')
})

it('shows pending verification instead of navigating into the dashboard after signup', async () => {
  auth.signup.mockResolvedValueOnce({ verificationRequired: true, email: 'member@example.invalid' })
  await form(render(SignupPage)).props.onSubmit(submit)
  const tree = render(SignupPage)
  expect(tree.type).toBe(EmailVerificationPending)
  expect(tree.props.email).toBe('member@example.invalid')
  expect(navigate).not.toHaveBeenCalled()
})

it('does not consume a verification link automatically and submits password proof on user action', async () => {
  window.location.hash = `#token=${'v'.repeat(43)}`
  let tree = render(VerifyEmailPage)
  expect(auth.verifyEmail).not.toHaveBeenCalled()
  field(tree, 'password')[0].props.onChange({ target: { value: 'valid-password' } })
  tree = render(VerifyEmailPage)
  auth.verifyEmail.mockImplementationOnce(async (_token, _password, { isCurrent, onVerified }) => {
    const user = { id: 'fixture-account', email: 'member@example.invalid', displayName: 'Fixture', role: 'candidate', mustChangePassword: false,
      emailVerified: true, isAdmin: false, isRecruiter: false, isDeveloper: false }
    if (isCurrent()) onVerified(user)
    return user
  })
  await form(tree).props.onSubmit(submit)
  expect(auth.verifyEmail.mock.calls.length).toBe(1)
  expect(auth.verifyEmail.mock.calls[0][0] === 'v'.repeat(43)).toBe(true)
  expect(auth.verifyEmail.mock.calls[0][1] === 'valid-password').toBe(true)
  expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true })
  expect(readAccountLinkToken()).toBe('')
})

it('requests correction with the original address and password, not an unproved replacement account', async () => {
  let tree = render(EmailVerificationPending, { email: 'original@example.invalid' })
  field(tree, 'password')[0].props.onChange({ target: { value: 'valid-password' } })
  field(tree, 'email')[1].props.onChange({ target: { value: 'correct@example.invalid' } })
  tree = render(EmailVerificationPending)
  api.post.mockResolvedValueOnce({ ok: true, message: '요청을 처리했습니다.' })
  await form(tree).props.onSubmit({ ...submit, nativeEvent: { submitter: { value: 'correct' } } })
  expect(api.post).toHaveBeenCalledWith('/account/correct-email', {
    email: 'original@example.invalid', password: 'valid-password', newEmail: 'correct@example.invalid', remember: true,
  })
})

it('requests a reset without a password and shows the generic server message', async () => {
  let tree = render(ForgotPasswordPage)
  field(tree, 'email')[0].props.onChange({ target: { value: 'member@example.invalid' } })
  tree = render(ForgotPasswordPage)
  api.post.mockResolvedValueOnce({ ok: true, message: '입력한 정보로 진행할 수 있으면 이메일을 보냅니다.' })
  await form(tree).props.onSubmit(submit)
  expect(api.post).toHaveBeenCalledWith('/account/forgot-password', { email: 'member@example.invalid' })
  expect(walk(render(ForgotPasswordPage)).some((node) => node.props.role === 'status')).toBe(true)
})

it('requires matching new passwords and never submits a reset proof until the user chooses to', async () => {
  window.location.pathname = '/reset-password'
  window.location.hash = `#token=${'r'.repeat(43)}`
  let tree = render(ResetPasswordPage)
  expect(api.post).not.toHaveBeenCalled()
  field(tree, 'password')[0].props.onChange({ target: { value: 'replacement-password' } })
  field(tree, 'password')[1].props.onChange({ target: { value: 'mismatch-password' } })
  await form(render(ResetPasswordPage)).props.onSubmit(submit)
  expect(api.post).not.toHaveBeenCalled()
  tree = render(ResetPasswordPage)
  field(tree, 'password')[1].props.onChange({ target: { value: 'replacement-password' } })
  api.post.mockResolvedValueOnce({ ok: true })
  await form(render(ResetPasswordPage)).props.onSubmit(submit)
  expect(api.post).toHaveBeenCalledWith('/account/reset-password', { token: 'r'.repeat(43), newPassword: 'replacement-password' })
  tree = render(ResetPasswordPage)
  expect(form(tree)).toBeUndefined()
  expect(walk(tree).find((node) => node.type === 'a').props.href).toBe('/login')
  expect(readAccountLinkToken()).toBe('')
})
