import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Run page handlers with controlled React hook lifetimes; browser coverage uses
// the real loopback server and disposable 503 responses, never live mail/data.
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('react', async original => {
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]))
  return { ...await original(),
    useState(initial) {
      const cell = host.cells[host.index++] ||= { value: typeof initial === 'function' ? initial() : initial }
      return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; host.dirty = true }]
    },
    useRef(value) { return host.cells[host.index++] ||= { current: value } },
    useCallback(callback, deps) {
      const index = host.index++
      if (!host.cells[index] || changed(host.cells[index].deps, deps)) host.cells[index] = { callback, deps }
      return host.cells[index].callback
    },
    useMemo(factory, deps) {
      const index = host.index++
      if (!host.cells[index] || changed(host.cells[index].deps, deps)) host.cells[index] = { value: factory(), deps }
      return host.cells[index].value
    },
    useEffect(effect, deps) {
      const index = host.index++
      if (!host.cells[index] || changed(host.cells[index].deps, deps)) {
        host.cells[index]?.cleanup?.()
        host.cells[index] = { deps }
        host.effects.push(() => { host.cells[index].cleanup = effect() })
      }
    },
  }
})
vi.mock('react-router-dom', () => ({ Link: 'test-link', useParams: () => ({ id: 'posting' }), useNavigate: () => vi.fn() }))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }, downloadApiFile: vi.fn(), markRoomDoor: vi.fn() }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { role: 'company', isRecruiter: true } }) }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
import { api } from '../src/api/client.js'
import RecruitPage, { ApplicationDetail } from '../src/pages/RecruitPage.jsx'
import JobsPage from '../src/pages/JobsPage.jsx'
import JobDetailPage from '../src/pages/JobDetailPage.jsx'

let Page, tree
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const button = label => walk(tree).find(node => node.type === 'button' && text(node) === label)
const input = label => walk(walk(tree).find(node => node.type === 'label' && text(node).replace('*', '').trim() === label)).find(node => node.type === 'input')
function render() {
  for (let attempt = 0; attempt < 15; attempt++) {
    host.index = 0; host.effects = []; host.dirty = false
    tree = Page()
    for (const effect of host.effects) effect()
    if (!host.dirty) return tree
  }
  throw new Error('Page did not settle')
}
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); render() }
const posting = { id: 'posting', title: 'Stored job', status: 'open', applicationCount: 1, createdAt: '2026-09-19T00:00:00Z' }
const application = { id: 'application', applicantName: 'Synthetic candidate', applicantEmail: 'test@example.invalid', postingTitle: 'Stored job', status: 'submitted', createdAt: '2026-09-19T00:00:00Z' }
const responses = path => Promise.resolve(path === '/posting-drafts' ? { drafts: [] } : path === '/applications' ? { applications: [application] } : { postings: [posting] })
const fail = () => Promise.reject(new Error('Synthetic read outage'))

beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.dirty = false
  Page = RecruitPage
  api.get.mockImplementation(responses)
  vi.stubGlobal('window', { confirm: vi.fn(() => true) })
})
afterEach(() => { for (const cell of host.cells) cell.cleanup?.(); vi.unstubAllGlobals() })

it('does not call a failed public lookup an empty list and retries using GET only', async () => {
  Page = JobsPage; api.get.mockImplementation(fail); render(); await settle()
  expect(text(tree)).toContain('공고 목록을 불러오지 못했습니다.')
  expect(text(tree)).not.toContain('현재 모집 중인 공고가 없습니다.')
  api.get.mockResolvedValueOnce({ postings: [posting] })
  button('공고 다시 불러오기').props.onClick(); render(); await settle()
  expect(text(tree)).toContain('Stored job')
  expect(text(tree)).not.toContain('Synthetic read outage')
  expect(api.post).not.toHaveBeenCalled()
})

it('shows the public empty state only after a successful empty response', async () => {
  Page = JobsPage; api.get.mockResolvedValue({ postings: [] }); render(); await settle()
  expect(text(tree)).toContain('현재 모집 중인 공고가 없습니다.')
  expect(button('공고 다시 불러오기')).toBeUndefined()
})

it('recovers a failed public job detail through GET without presenting an apply action first', async () => {
  Page = JobDetailPage; api.get.mockImplementation(fail); render(); await settle()
  expect(text(tree)).toContain('Synthetic read outage')
  expect(button('지원하기')).toBeUndefined()
  api.get.mockResolvedValueOnce({ posting: { ...posting, open: true } })
  button('공고 다시 불러오기').props.onClick(); render(); await settle()
  expect(text(tree)).toContain('Stored job')
  expect(button('지원하기')).toBeDefined()
  expect(api.get.mock.calls).toEqual([['/jobs/posting'], ['/jobs/posting']])
  expect(api.post).not.toHaveBeenCalled()
})

it('keeps successful postings when applications fail and retries only the failed source', async () => {
  api.get.mockImplementation(path => path === '/applications' ? fail() : responses(path))
  render(); await settle()
  expect(text(tree)).toContain('Stored job')
  expect(text(tree)).toContain('지원서 목록을 불러오지 못했습니다.')
  expect(text(tree)).not.toContain('아직 접수된 지원서가 없습니다.')
  const postingReads = api.get.mock.calls.filter(([path]) => path === '/postings').length
  input('공고 제목').props.onChange({ target: { value: '작성 중인 새 공고' } }); render()
  api.get.mockImplementation(responses)
  await button('지원서 목록 다시 불러오기').props.onClick(); await settle()
  expect(text(tree)).toContain('Synthetic candidate')
  expect(input('공고 제목').props.value).toBe('작성 중인 새 공고')
  expect(api.get.mock.calls.filter(([path]) => path === '/postings')).toHaveLength(postingReads)
})

it('keeps successful applications when postings fail without claiming there are no jobs', async () => {
  api.get.mockImplementation(path => path === '/postings' ? fail() : responses(path))
  render(); await settle()
  expect(text(tree)).toContain('Synthetic candidate')
  expect(text(tree)).toContain('공고 목록을 불러오지 못했습니다.')
  expect(text(tree)).not.toContain('등록된 공고가 없습니다.')
  expect(button('공고 다시 불러오기')).toBeDefined()
})

it('reports a committed posting before refresh and does not replay its POST during recovery', async () => {
  render(); await settle()
  input('공고 제목').props.onChange({ target: { value: 'One committed posting' } }); render()
  api.post.mockResolvedValue({ id: 'new' })
  api.get.mockImplementation(path => path === '/posting-drafts' ? responses(path) : fail())
  await walk(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await settle()
  expect(toast.success).toHaveBeenCalledWith('공고가 정상 등록되었습니다.')
  expect(toast.error).not.toHaveBeenCalled()
  expect(input('공고 제목').props.value).toBe('')
  expect(text(tree)).toContain('목록을 다시 확인해주세요.')
  api.get.mockImplementation(responses)
  await button('공고 다시 불러오기').props.onClick(); await settle()
  expect(api.post).toHaveBeenCalledOnce()
})

it('retains an unconfirmed posting operation and locks edits until its explicit retry succeeds', async () => {
  render(); await settle()
  input('공고 제목').props.onChange({ target: { value: 'One operation' } }); render()
  api.post.mockRejectedValueOnce(new Error('Response lost after commit'))
  await walk(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await settle()
  expect(text(tree)).toContain('공고 등록 결과를 확인하지 못했습니다')
  expect(walk(tree).find(node => node.type === 'fieldset' && node.props.className === 'posting-draft-fields').props.disabled).toBe(true)
  expect(input('공고 제목').props.value).toBe('One operation')
  const original = api.post.mock.calls[0][1]
  api.post.mockResolvedValueOnce({ id: 'stored', recovered: true })
  await button('같은 요청으로 등록 다시 시도').props.onClick({ preventDefault() {} }); await settle()
  expect(api.post.mock.calls[1][1]).toEqual(original)
  expect(input('공고 제목').props.value).toBe('')
  expect(text(tree)).not.toContain('공고 등록 결과를 확인하지 못했습니다')
  expect(toast.success).toHaveBeenCalledTimes(1)
})

it('retains form values after a rejected create without refreshing or reporting success', async () => {
  render(); await settle()
  input('공고 제목').props.onChange({ target: { value: 'Keep rejected input' } }); render()
  const reads = api.get.mock.calls.length
  api.post.mockRejectedValue(new Error('Rejected write'))
  await walk(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await settle()
  expect(input('공고 제목').props.value).toBe('Keep rejected input')
  expect(toast.success).not.toHaveBeenCalled()
  expect(api.get).toHaveBeenCalledTimes(reads)
})

it.each([['마감하기', 'patch', '공고를 마감했습니다.'], ['삭제', 'delete', '공고가 삭제되었습니다.']])('separates successful %s from a failed list refresh', async (label, method, message) => {
  render(); await settle(); api[method].mockResolvedValue({})
  api.get.mockImplementation(path => path === '/posting-drafts' ? responses(path) : fail())
  await button(label).props.onClick(); await settle()
  expect(toast.success).toHaveBeenCalledWith(message)
  expect(toast.error).not.toHaveBeenCalled()
  expect(button('공고 다시 불러오기')).toBeDefined()
  expect(api[method]).toHaveBeenCalledOnce()
})

it('offers a GET-only recovery instead of an endless spinner after application detail failure', async () => {
  Page = () => ApplicationDetail({ appId: 'application', onClose() {}, onChanged() {}, canPass: true })
  api.get.mockImplementation(fail); render(); await settle()
  expect(text(tree)).toContain('지원서 상세를 불러오지 못했습니다.')
  expect(text(tree)).not.toContain('불러오는 중...')
  api.get.mockResolvedValue({ application: { ...application, career: [], documents: [], consent: {} } })
  await button('지원서 다시 불러오기').props.onClick(); await settle()
  expect(text(tree)).toContain('Synthetic candidate')
  expect(button('불합격')).toBeDefined()
  expect(api.post).not.toHaveBeenCalled()
})
