import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Exercise the real component handlers with deterministic hook state and a
// mocked API. Nothing in these tests contacts Gmail or production data.
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal()
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]))
  return {
    ...actual,
    useState(initial) {
      const i = host.index++
      const cell = host.cells[i] ||= { value: typeof initial === 'function' ? initial() : initial }
      return [cell.value, (value) => {
        cell.value = typeof value === 'function' ? value(cell.value) : value
        host.dirty = true
      }]
    },
    useCallback(callback, deps) {
      const i = host.index++
      if (!host.cells[i] || changed(host.cells[i].deps, deps)) host.cells[i] = { callback, deps }
      return host.cells[i].callback
    },
    useEffect(effect, deps) {
      const i = host.index++
      if (!host.cells[i] || changed(host.cells[i].deps, deps)) {
        host.cells[i] = { deps }
        host.effects.push(effect)
      }
    },
  }
})
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn() }, downloadApiFile: vi.fn(), markRoomDoor: vi.fn() }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { role: 'company' } }) }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
vi.mock('../src/components/Modal.jsx', () => ({ default: 'test-modal' }))
vi.mock('../src/components/NotificationBell.jsx', () => ({ default: 'notification-bell' }))
vi.mock('../src/components/ApplicantCompare.jsx', () => ({ default: 'applicant-compare' }))
vi.mock('../src/components/PostingEditor.jsx', () => ({ default: 'posting-editor' }))
vi.mock('../src/components/PostingQrModal.jsx', () => ({ default: 'posting-qr' }))
import { api } from '../src/api/client.js'
import ApplicationResultEmailStatus from '../src/components/ApplicationResultEmailStatus.jsx'
import { ApplicationDetail } from '../src/pages/RecruitPage.jsx'

const email = (status, canRetry = false) => ({ status, canRetry, sentAt: null, attemptedAt: null, message: null })
const application = (status = 'submitted', resultEmail = null) => ({
  id: 19, applicantName: '테스트 지원자', applicantEmail: 'applicant@example.test',
  applicantPhone: '010-0000-0000', status, resultEmail,
  career: [], documents: [], consent: {}, aiScreening: null,
})
const props = { appId: 19, onClose: vi.fn(), onChanged: vi.fn(), canPass: true }
const walk = (node) => {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(walk)
  return [node, ...walk(node.props?.children)]
}
const text = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node !== 'object') return String(node)
  return Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
}
let tree
function render() {
  for (let count = 0; count < 20; count++) {
    host.index = 0; host.effects = []; host.dirty = false
    tree = ApplicationDetail(props)
    for (const effect of host.effects) effect()
    if (!host.dirty) return tree
  }
  throw new Error('Application detail did not settle')
}
async function mount(detail = application()) {
  api.get.mockResolvedValue({ application: detail })
  render()
  for (let i = 0; i < 8; i++) await Promise.resolve()
  render()
}
const panel = () => walk(tree).find((node) => node.type === ApplicationResultEmailStatus)
const button = (label) => walk(tree).find((node) => node.type === 'button' && text(node).includes(label))
const markup = (state, extra = {}) => renderToStaticMarkup(
  <ApplicationResultEmailStatus resultEmail={state} onRetry={() => {}} onRefresh={() => {}} {...extra} />
)

beforeEach(() => {
  vi.resetAllMocks()
  host.cells = []; host.index = 0; host.effects = []; host.dirty = false
  vi.stubGlobal('window', { confirm: vi.fn(() => true) })
})
afterEach(() => vi.unstubAllGlobals())

describe('persisted result email display', () => {
  it('shows Gmail acceptance and a Korea-time timestamp without implying inbox delivery', () => {
    const html = markup({ ...email('sent'), sentAt: '2026-09-19T01:02:03Z' })
    expect(html).toContain('발송 완료 (Gmail 접수)')
    expect(html).toContain('2026-09-19 10:02 (한국 시간)')
    expect(html).toContain('수신함 도착이나 열람을 확인한 것은 아닙니다.')
    expect(html).not.toContain('결과 안내 이메일 보내기')
  })

  it.each(['sent', 'sending', 'unknown', 'legacy_unknown', 'unrecognized'])('never offers retry for %s, even if eligibility is inconsistent', (status) => {
    expect(markup(email(status, true))).not.toContain('결과 안내 이메일 보내기')
  })

  it.each(['pending', 'not_sent', 'failed'])('offers retry for %s only when the server permits it', (status) => {
    expect(markup(email(status, true))).toContain('결과 안내 이메일 보내기')
    expect(markup(email(status, false))).not.toContain('결과 안내 이메일 보내기')
  })

  it('does not describe legacy history or a missing response as known unsent', () => {
    expect(markup(email('legacy_unknown'))).toContain('이전 발송 기록 확인 불가')
    expect(markup(undefined)).toContain('발송 결과 확인 필요')
    expect(markup(undefined)).not.toContain('결과 안내 이메일 보내기')
  })

  it('disables actions while a request is in flight', () => {
    const html = markup(email('failed', true), { working: true })
    expect(html.match(/disabled=""/g)).toHaveLength(2)
  })

  it.each(['passed', 'rejected'])('restores persisted status for a reopened %s detail', async (status) => {
    const stored = { ...email('failed', true), attemptedAt: '2026-09-19T01:02:03Z' }
    await mount(application(status, stored))
    expect(panel().props.resultEmail).toEqual(stored)
    expect(markup(panel().props.resultEmail)).toContain('최근 발송 시도: 2026-09-19 10:02')
  })

  it('does not present outcome-email status before a decision', async () => {
    await mount()
    expect(panel()).toBeUndefined()
  })
})

describe('decision and retry interactions', () => {
  it.each([
    ['서류합격', 'pass', 'passed'],
    ['불합격', 'reject', 'rejected'],
  ])('confirms automatic mail before %s and renders a failed send distinctly', async (label, path, status) => {
    await mount()
    api.post.mockResolvedValue({ emailStatus: 'failed', resultEmail: email('failed', true) })
    api.get.mockResolvedValue({ application: application(status, email('failed', true)) })
    await button(label).props.onClick()
    render()
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('이메일이 자동 발송됩니다.'))
    expect(api.post).toHaveBeenCalledExactlyOnceWith(`/applications/19/${path}`, { revision: 0 })
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('발송되지 않았습니다.'))
    expect(panel().props.resultEmail.status).toBe('failed')
  })

  it.each(['not_sent', 'unknown', 'sending'])('does not show success-only messaging for a %s outcome', async (status) => {
    await mount()
    api.post.mockResolvedValue({ resultEmail: email(status) })
    api.get.mockResolvedValue({ application: application('rejected', email(status)) })
    await button('불합격').props.onClick()
    render()
    expect(toast.success).not.toHaveBeenCalled()
    expect(status === 'not_sent' ? toast.error : toast.info).toHaveBeenCalled()
    expect(panel().props.resultEmail.status).toBe(status)
  })

  it.each(['passed', 'rejected'])('confirms an actual retry for %s and uses the unified endpoint', async (status) => {
    await mount(application(status, email('failed', true)))
    api.post.mockResolvedValue({ resultEmail: email('sent'), sentTo: 'a***@example.test' })
    api.get.mockResolvedValue({ application: application(status, email('sent')) })
    await panel().props.onRetry()
    render()
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('applicant@example.test'))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('실제로 발송하시겠습니까?'))
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/applications/19/send-result-email', {})
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Gmail이'))
    expect(panel().props.resultEmail.status).toBe('sent')
  })

  it('makes no send request when the confirmation is canceled', async () => {
    await mount(application('rejected', email('failed', true)))
    window.confirm.mockReturnValue(false)
    await panel().props.onRetry()
    expect(api.post).not.toHaveBeenCalled()
  })

  it.each(['sent', 'sending', 'unknown', 'legacy_unknown'])('guards the retry handler against a %s result', async (status) => {
    await mount(application('rejected', email(status, true)))
    await panel().props.onRetry()
    expect(window.confirm).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('locks retries after a lost response when the persisted state cannot be retrieved', async () => {
    await mount(application('rejected', email('failed', true)))
    api.post.mockRejectedValue(new Error('연결이 끊겼습니다.'))
    api.get.mockRejectedValue(new Error('상태 조회 실패'))
    await panel().props.onRetry()
    render()
    expect(panel()).toBeUndefined()
    expect(text(tree)).toContain('지원서 상세를 불러오지 못했습니다.')
    // The recovery button retries only the read; uncertain delivery is never
    // exposed as a send action while persisted state is unavailable.
    await button('지원서 다시 불러오기').props.onClick()
    render()
    expect(api.post).toHaveBeenCalledTimes(1)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('reloads status without sending email', async () => {
    await mount(application('passed', email('sending')))
    api.get.mockResolvedValue({ application: application('passed', email('sent')) })
    await panel().props.onRefresh()
    render()
    expect(panel().props.resultEmail.status).toBe('sent')
    expect(api.post).not.toHaveBeenCalled()
  })
})
