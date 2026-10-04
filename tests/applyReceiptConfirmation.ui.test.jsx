import { beforeEach, afterEach, it, expect, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('react', async original => ({
  ...await original(),
  useState(initial) {
    const cell = host.cells[host.index++] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, value => {
      cell.value = typeof value === 'function' ? value(cell.value) : value
      host.dirty = true
    }]
  },
  useRef(initial) { return host.cells[host.index++] ||= { current: initial } },
  useMemo(create) { host.index++; return create() },
  useEffect(effect, deps) {
    const index = host.index++
    const previous = host.cells[index]
    if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) {
      previous?.cleanup?.()
      const cell = host.cells[index] = { deps }
      host.effects.push(() => { cell.cleanup = effect() })
    }
  },
}))
vi.mock('react-router-dom', () => ({ Link: 'test-link', useParams: () => ({ id: 'posting' }), useNavigate: () => vi.fn() }))
vi.mock('../src/api/client.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), upload: vi.fn() },
  API_BASE: '/api', getAccountAuthRevision: () => 0,
}))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
vi.mock('../src/components/UnsavedChangesGuard.jsx', () => ({ default: () => null }))

import { api } from '../src/api/client.js'
import ApplyPage from '../src/pages/ApplyPage.jsx'
import { onRequestPost as apply } from '../server/api/jobs/[id]/apply.js'

let tree, storage
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object'
  ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const field = test => walk(tree).find(test)
const form = () => field(node => node.type === 'form')
const emailInput = () => field(node => node.type === 'input' && node.props.type === 'email')
const recoveredMessage = '기존에 접수된 지원 내역을 확인했습니다.'
const editedInputMessage = '현재 화면에서 수정한 내용이 저장되었다는 뜻은 아닙니다.'
const receipt = { ok: true, applicationId: 'application-original', lookupCode: 'OLD2345ABC', status: 'submitted' }

function render() {
  for (let count = 0; count < 10; count++) {
    host.index = 0; host.effects = []; host.dirty = false
    tree = ApplyPage()
    for (const effect of host.effects) effect()
    if (!host.dirty) return
  }
  throw new Error('Synthetic render loop')
}
async function settle() { for (let count = 0; count < 15; count++) await Promise.resolve(); render() }
async function startForm() {
  render(); await settle()
  field(node => node.type === 'input' && node.props.maxLength === 100).props.onChange({ target: { value: 'Synthetic applicant' } })
  emailInput().props.onChange({ target: { value: 'original@example.invalid' } })
  field(node => node.type === 'input' && node.props.maxLength === 40).props.onChange({ target: { value: '010-0000-0000' } })
  field(node => node.type === 'input' && node.props.type === 'file').props.onChange({
    target: { files: [new File(['%PDF-1.4'], 'original.pdf')] },
  })
  field(node => node.props?.item?.key === 'consentRequired').props.onToggle(true)
  render()
}
function assertNeutralCompletion() {
  expect(text(tree)).toContain('지원이 완료되었습니다')
  expect(text(tree)).toContain('지원서에 제출된 이메일로')
  expect(text(tree)).toContain(receipt.lookupCode)
  expect(text(tree)).not.toContain('original@example.invalid')
  expect(text(tree)).not.toContain('edited@example.invalid')
  expect(field(node => node.type === 'test-link' && node.props.to === '/application-manage')).toBeDefined()
}
function assertRecoveredCompletion() {
  assertNeutralCompletion()
  expect(text(tree)).toContain(recoveredMessage)
  expect(text(tree)).toContain(editedInputMessage)
  // This distinction remains in the completion view after another render,
  // independent of whether the success toast is still visible.
  render()
  expect(text(tree)).toContain(recoveredMessage)
  expect(text(tree)).toContain(editedInputMessage)
}

beforeEach(() => {
  vi.clearAllMocks()
  host.cells = []; host.index = 0; host.effects = []
  storage = new Map()
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn(key => storage.get(key) ?? null),
    setItem: vi.fn((key, value) => storage.set(key, value)),
    removeItem: vi.fn(key => storage.delete(key)),
  })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External HTTP is forbidden in this test') }))
  api.get.mockResolvedValue({ posting: { title: 'Synthetic role', status: 'open', open: true } })
  api.post.mockRejectedValue(new Error('Synthetic receipt lookup unavailable'))
})
afterEach(() => {
  for (const cell of host.cells) cell?.cleanup?.()
  expect(fetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

it('control: confirms a normal submission using submitted-email wording and keeps the existing management link', async () => {
  await startForm()
  api.upload.mockResolvedValueOnce(receipt)
  await form().props.onSubmit({ preventDefault() {} }); await settle()
  expect(api.upload).toHaveBeenCalledOnce()
  const payload = api.upload.mock.calls[0][1]
  expect(payload.get('applicantEmail')).toBe('original@example.invalid')
  expect(payload.get('resume').name).toBe('original.pdf')
  assertNeutralCompletion()
  expect(text(tree)).not.toContain(recoveredMessage)
  expect(text(tree)).not.toContain(editedInputMessage)
  expect(toast.success).toHaveBeenCalledWith('지원서가 정상 제출되었습니다.')
})

it('does not claim a pending email edit was the submitted email when the original upload succeeds', async () => {
  await startForm()
  let resolveUpload
  api.upload.mockReturnValueOnce(new Promise(resolve => { resolveUpload = resolve }))
  const pending = form().props.onSubmit({ preventDefault() {} })
  render()
  expect(emailInput().props.disabled).not.toBe(true)
  emailInput().props.onChange({ target: { value: 'edited@example.invalid' } }); render()
  resolveUpload(receipt); await pending; await settle()
  expect(api.upload.mock.calls[0][1].get('applicantEmail')).toBe('original@example.invalid')
  expect(api.post).not.toHaveBeenCalled()
  assertNeutralCompletion()
  expect(text(tree)).not.toContain(recoveredMessage)
})

it('distinguishes an original receipt recovered by a same-token retry from the edited input after an unknown result', async () => {
  await startForm()
  api.upload.mockRejectedValueOnce(new Error('Synthetic response loss after commit'))
  await form().props.onSubmit({ preventDefault() {} }); await settle()
  const originalPayload = api.upload.mock.calls[0][1]
  const originalToken = originalPayload.get('operationToken')
  expect(originalPayload.get('applicantEmail')).toBe('original@example.invalid')
  expect(originalToken).toMatch(/^[a-f0-9]{64}$/)
  expect(form()).toBeDefined()
  expect(api.post).toHaveBeenCalledWith('/application-receipt', { postingId: 'posting', operationToken: originalToken })
  emailInput().props.onChange({ target: { value: 'edited@example.invalid' } }); render()

  const statements = []
  const DB = { prepare(sql) {
    statements.push(sql)
    expect(sql).toContain('submission_key_hash')
    return { bind() { return this }, async first() {
      return { id: receipt.applicationId, lookup_code: receipt.lookupCode, status: 'submitted', withdrawn_at: null }
    } }
  } }
  api.upload.mockImplementationOnce(async (_path, payload) => {
    expect(payload.get('operationToken')).toBe(originalToken)
    expect(payload.get('applicantEmail')).toBe('edited@example.invalid')
    // The real handler returns the already saved receipt before validating or
    // storing this changed payload. The database substitute allows SELECT only.
    const response = await apply({ env: { DB }, params: { id: 'posting' }, data: {}, request: { async formData() { return payload } } })
    expect(response.status).toBe(200)
    return response.json()
  })
  await form().props.onSubmit({ preventDefault() {} }); await settle()
  expect(api.upload).toHaveBeenCalledTimes(2)
  expect(statements).toHaveLength(1)
  assertRecoveredCompletion()
  expect(toast.success).toHaveBeenCalledWith('기존 접수 내역을 확인했습니다.')
})

it('keeps the recovered distinction when receipt lookup resolves a lost upload response', async () => {
  await startForm()
  api.upload.mockRejectedValueOnce(new Error('Synthetic response loss after commit'))
  api.post.mockResolvedValueOnce(receipt)
  await form().props.onSubmit({ preventDefault() {} }); await settle()
  expect(api.upload).toHaveBeenCalledOnce()
  assertRecoveredCompletion()
})

it('keeps the recovered distinction when restoring a persisted operation on page load', async () => {
  storage.set('portfolioApplicationOperation:posting', 'a'.repeat(64))
  api.post.mockResolvedValueOnce(receipt)
  render(); await settle()
  assertRecoveredCompletion()
  expect(api.upload).not.toHaveBeenCalled()
})

it('clears the recovered distinction when a withdrawn receipt starts a new application', async () => {
  storage.set('portfolioApplicationOperation:posting', 'a'.repeat(64))
  api.post.mockResolvedValueOnce({ ...receipt, status: 'withdrawn' })
  render(); await settle()
  expect(text(tree)).toContain(recoveredMessage)
  field(node => node.type === 'button' && text(node) === '새 지원서 작성').props.onClick(); render()
  expect(storage.get('portfolioApplicationOperation:posting')).not.toBe('a'.repeat(64))
  await startForm()
  api.upload.mockResolvedValueOnce({ ...receipt, lookupCode: 'NEW2345ABC' })
  await form().props.onSubmit({ preventDefault() {} }); await settle()
  expect(text(tree)).toContain('NEW2345ABC')
  expect(text(tree)).not.toContain(recoveredMessage)
  expect(text(tree)).not.toContain(editedInputMessage)
})
