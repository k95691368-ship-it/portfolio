import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Run the real comparison component with controlled React lifetimes. All API
// calls are mocks, and any accidental network request fails the test.
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
const toast = vi.hoisted(() => ({ error: vi.fn() }))
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
    useEffect(effect, deps) {
      const index = host.index++
      const previous = host.cells[index]
      if (!previous || changed(previous.deps, deps)) {
        host.cells[index] = { deps, cleanup: previous?.cleanup }
        host.effects.push(() => { host.cells[index].cleanup?.(); host.cells[index].cleanup = effect() })
      }
    },
  }
})
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
import { api } from '../src/api/client.js'
import ApplicantCompare from '../src/components/ApplicantCompare.jsx'

let tree, props
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const button = label => walk(tree).find(node => node.type === 'button' && text(node) === label)
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }
const response = (postingId = 'posting-A', applicantName = 'Applicant A', overrides = {}) => ({
  posting: { id: postingId, title: `Role ${postingId.slice(-1)}`, department: '', employmentType: '', location: '' },
  summary: { total: 1, byFit: { high: 1, medium: 0, low: 0, unknown: 0 }, passed: 0, unscreened: 0 },
  applicants: [{ id: `app-${postingId.slice(-1)}`, rank: 1, applicantName, status: 'submitted',
    fit: 'high', fitLabel: '적합도 높음', careerLabel: '1년', companies: [], basis: 'Synthetic basis', strengths: [], concerns: [] }],
  truncated: false, limit: 300, ...overrides,
})
function commitEffects() {
  const effects = host.effects
  host.effects = []
  for (const effect of effects) effect()
}
function render(commit = true) {
  for (let count = 0; count < 20; count++) {
    host.index = 0; host.effects = []; host.dirty = false
    tree = ApplicantCompare(props)
    if (!commit) return tree
    commitEffects()
    if (!host.dirty) return tree
  }
  throw new Error('Comparison render did not settle')
}
async function flush() { for (let count = 0; count < 20; count++) await Promise.resolve() }
async function settle() { await flush(); render() }
async function mount(result = response()) { api.get.mockResolvedValueOnce(result); render(); await settle() }
const switchPosting = (postingId, title) => { props = { ...props, postingId, postingTitle: title } }
const unmount = () => { for (const cell of host.cells) cell.cleanup?.() }

beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.dirty = false
  props = { postingId: 'posting-A', postingTitle: 'Role A', onClose: vi.fn(), onOpenApplication: vi.fn() }
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network requests are blocked in the comparison regression') }))
})
afterEach(() => {
  unmount()
  expect(fetch).not.toHaveBeenCalled()
  for (const method of ['post', 'put', 'patch', 'delete']) expect(api[method]).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

it('does not render A data or use its captured action under B even before effects run', async () => {
  await mount()
  const oldOpen = button('지원서 보기').props.onClick
  api.get.mockReturnValueOnce(deferred().promise)
  switchPosting('posting-B', 'Role B'); render(false)
  expect(text(tree)).toContain('지원자 비교 — Role B')
  expect(text(tree)).not.toContain('Applicant A')
  expect(walk(tree).some(node => node.props?.className === 'compare-summary')).toBe(false)
  expect(button('지원서 보기')).toBeUndefined()
  oldOpen()
  expect(props.onOpenApplication).not.toHaveBeenCalled()
  commitEffects(); render()
})

it('replaces a failed B lookup with B recovery, and retries only the current GET', async () => {
  await mount()
  api.get.mockRejectedValueOnce(new Error('B read failed'))
  switchPosting('posting-B', 'Role B'); render(); await settle()
  expect(text(tree)).toContain('지원자 비교 — Role B')
  expect(text(tree)).toContain('B read failed')
  expect(text(tree)).not.toContain('Applicant A')
  expect(walk(tree).some(node => node.props?.className === 'compare-summary')).toBe(false)
  expect(button('지원서 보기')).toBeUndefined()
  api.get.mockResolvedValueOnce(response('posting-B', 'Applicant B'))
  button('지원자 비교 다시 불러오기').props.onClick(); render(); await settle()
  expect(text(tree)).toContain('Applicant B')
  expect(text(tree)).not.toContain('B read failed')
  button('지원서 보기').props.onClick()
  expect(props.onOpenApplication).toHaveBeenCalledExactlyOnceWith('app-B')
  expect(api.get.mock.calls.map(([path]) => path)).toEqual([
    '/postings/posting-A/applications', '/postings/posting-B/applications', '/postings/posting-B/applications',
  ])
})

it('aborts an old request and ignores its late rejection while B is still loading', async () => {
  const old = deferred(), current = deferred()
  api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
  render()
  const oldSignal = api.get.mock.calls[0][1]?.signal
  switchPosting('posting-B', 'Role B'); render()
  old.reject(new Error('Late A failure')); await settle()
  expect(oldSignal?.aborted).toBe(true)
  expect(text(tree)).toContain('불러오는 중...')
  expect(text(tree)).not.toContain('Late A failure')
  expect(toast.error).not.toHaveBeenCalled()
  current.resolve(response('posting-B', 'Applicant B')); await settle()
  expect(text(tree)).toContain('Applicant B')
})

it('keeps B success when the aborted A request still resolves late', async () => {
  const old = deferred(), current = deferred()
  api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
  render(); switchPosting('posting-B', 'Role B'); render()
  current.resolve(response('posting-B', 'Applicant B')); await settle()
  old.resolve(response()); await settle()
  expect(text(tree)).toContain('Applicant B')
  expect(text(tree)).not.toContain('Applicant A')
  expect(button('지원자 비교 다시 불러오기')).toBeUndefined()
})

it.each(['resolve', 'reject'])('aborts on exit and ignores a late %s without state updates or a toast', async outcome => {
  const pending = deferred(); api.get.mockReturnValueOnce(pending.promise)
  render()
  const signal = api.get.mock.calls[0][1]?.signal
  unmount(); host.dirty = false
  if (outcome === 'resolve') pending.resolve(response())
  else pending.reject(new Error('Exited request failure'))
  await flush()
  expect(signal?.aborted).toBe(true)
  expect(host.dirty).toBe(false)
  expect(toast.error).not.toHaveBeenCalled()
})

it('coalesces duplicate same-tick retries and locks the retry button while loading', async () => {
  api.get.mockRejectedValueOnce(new Error('Read failed')); render(); await settle()
  const pending = deferred(); api.get.mockReturnValueOnce(pending.promise)
  const retry = button('지원자 비교 다시 불러오기').props.onClick
  retry(); retry(); render()
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(button('지원자 비교 다시 불러오기').props.disabled).toBe(true)
  pending.resolve(response()); await settle()
  expect(text(tree)).toContain('Applicant A')
  expect(button('지원자 비교 다시 불러오기')).toBeUndefined()
})

it('does not use a captured old retry after the current posting changes or the panel exits', async () => {
  api.get.mockRejectedValueOnce(new Error('A failed')); render(); await settle()
  const oldRetry = button('지원자 비교 다시 불러오기').props.onClick
  const current = deferred(); api.get.mockReturnValueOnce(current.promise)
  switchPosting('posting-B', 'Role B'); render(false)
  oldRetry(); expect(api.get).toHaveBeenCalledTimes(1)
  commitEffects(); render()
  expect(api.get).toHaveBeenCalledTimes(2)
  unmount(); oldRetry(); expect(api.get).toHaveBeenCalledTimes(2)
  current.resolve(response('posting-B', 'Applicant B')); await flush()
})

it('shows a true empty state only for a successful current lookup, including recovery', async () => {
  api.get.mockRejectedValueOnce(new Error('Read failed')); render(); await settle()
  expect(text(tree)).not.toContain('이 공고에 접수된 지원서가 없습니다.')
  const empty = response('posting-A', '', { applicants: [], summary: { total: 0, byFit: {}, passed: 0, unscreened: 0 } })
  api.get.mockResolvedValueOnce(empty)
  button('지원자 비교 다시 불러오기').props.onClick(); render(); await settle()
  expect(text(tree)).toContain('이 공고에 접수된 지원서가 없습니다.')
  expect(button('지원서 보기')).toBeUndefined()
  expect(button('지원자 비교 다시 불러오기')).toBeUndefined()
})

it('preserves normal A to B success, the 300-person limit warning and screening notice', async () => {
  await mount()
  api.get.mockResolvedValueOnce(response('posting-B', 'Applicant B', {
    truncated: true, limit: 300, summary: { total: 300, byFit: { high: 298, medium: 1, low: 0, unknown: 1 }, passed: 2, unscreened: 1 },
  }))
  switchPosting('posting-B', 'Role B'); render(); await settle()
  expect(text(tree)).toContain('Applicant B')
  expect(text(tree)).not.toContain('Applicant A')
  expect(text(tree)).toContain('전체 300명')
  expect(text(tree)).toContain('최근 300명까지만 비교했습니다.')
  expect(text(tree)).toContain('통계는 표시된 범위 기준입니다.')
  expect(text(tree)).toContain('아직 AI 심사를 하지 않은 지원서가 1건 있습니다.')
  button('닫기').props.onClick()
  expect(props.onClose).toHaveBeenCalledOnce()
})
