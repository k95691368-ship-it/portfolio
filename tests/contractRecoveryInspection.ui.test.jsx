import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], cleanups: [], dirty: false }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
const pdfSave = vi.hoisted(() => vi.fn())
vi.mock('react', async original => ({
  ...await original(),
  useState(initial) {
    const index = host.index++
    const cell = host.cells[index] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; host.dirty = true }]
  },
  useRef(value) { return host.cells[host.index++] ||= { current: value } },
  useCallback(callback, deps) {
    const index = host.index++
    if (!host.cells[index] || deps.some((value, i) => !Object.is(value, host.cells[index].deps[i]))) host.cells[index] = { deps, callback }
    return host.cells[index].callback
  },
  useEffect(effect, deps) {
    const index = host.index++
    if (!host.cells[index] || deps.some((value, i) => !Object.is(value, host.cells[index].deps[i]))) {
      host.cells[index] = { deps, effect }; host.effects.push(effect)
    }
  },
}))
vi.mock('react-router-dom', () => ({ Link: 'test-link', useParams: () => ({ roomId: 'room' }) }))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() }, downloadApiFile: vi.fn() }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'owner', isRecruiter: true } }) }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
vi.mock('html2canvas', () => ({ default: vi.fn(async () => ({ width: 100, height: 100, toDataURL: () => 'data:image/png;base64,AA==' })) }))
vi.mock('jspdf', () => ({ jsPDF: class {
  internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } }
  addImage() {}
  addPage() {}
  output() { return new Blob(['local synthetic PDF'], { type: 'application/pdf' }) }
  save = pdfSave
} }))

import { api } from '../src/api/client.js'
import ContractPage from '../src/pages/ContractPage.jsx'
import SignatureModal from '../src/components/SignatureModal.jsx'
import UnsavedChangesGuard from '../src/components/UnsavedChangesGuard.jsx'

let tree
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const button = label => walk(tree).find(node => node.type === 'button' && text(node) === label)
const input = label => walk(walk(tree).find(node => node.type === 'label' && text(node) === label)).find(node => node.type === 'input')
const child = prop => walk(tree).find(node => typeof node.props?.[prop] === 'function')
function render() {
  for (let count = 0; count < 12; count++) {
    host.index = 0; host.effects = []; host.dirty = false; tree = ContractPage()
    for (const effect of host.effects) { const cleanup = effect(); if (typeof cleanup === 'function') host.cleanups.push(cleanup) }
    if (!host.dirty) return tree
  }
  throw new Error('render loop')
}
async function settle() { for (let count = 0; count < 20; count++) await Promise.resolve(); render() }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const view = (terms = {}) => ({
  room: { id: 'room', title: 'Synthetic contract', status: 'open', myRole: 'company', participants: [] },
  contract: { terms, hireConfirmed: true, updatedAt: '2026-09-19T00:00:00.000Z' },
  signatures: [], history: [],
})
async function load(data = view({ wageBaseAmount: 1000000 })) {
  api.get.mockResolvedValueOnce(data)
  render(); await settle()
}
beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.cleanups = []; host.dirty = false
  vi.stubGlobal('window', { confirm: vi.fn(() => true), prompt: vi.fn(() => 'Synthetic reason') })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No external calls allowed') }))
})
afterEach(() => vi.unstubAllGlobals())

it('offers a GET-only retry when the initial contract view fails', async () => {
  api.get.mockRejectedValueOnce(new Error('Synthetic initial read failure'))
  render(); await settle()
  expect(button('계약서 다시 불러오기')).toBeDefined()
  api.get.mockResolvedValueOnce(view())
  await button('계약서 다시 불러오기').props.onClick(); await settle()
  expect(text(tree)).toContain('Synthetic contract')
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled()
})

it('reports a successful contract save separately from failed post-save refresh', async () => {
  api.get.mockResolvedValueOnce(view({ wageBaseAmount: 1000000 }))
  render(); await settle()
  input('기본급(원)').props.onChange({ target: { value: '2000000' } }); render()
  api.patch.mockResolvedValueOnce({})
  api.get.mockRejectedValueOnce(new Error('Synthetic refresh failure'))
  await button('저장').props.onClick(); await settle()
  expect(api.patch).toHaveBeenCalledOnce()
  expect(toast.success).toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
  expect(button('계약서 다시 불러오기')).toBeDefined()
  expect(button('저장').props.disabled).toBe(true)
})

it('blocks competing saves during a delayed refresh instead of rolling back the newest save', async () => {
  api.get.mockResolvedValueOnce(view({ wageBaseAmount: 1000000 }))
  render(); await settle()
  const staleSave = button('저장').props.onClick
  const oldRefresh = deferred()
  api.post.mockResolvedValueOnce({})
  api.get.mockReturnValueOnce(oldRefresh.promise)
  const translating = child('onTranslate').props.onTranslate('en')
  await settle()
  expect(button('저장').props.disabled).toBe(true)
  await staleSave()
  expect(api.patch).not.toHaveBeenCalled()
  input('기본급(원)').props.onChange({ target: { value: '2000000' } }); render()
  oldRefresh.resolve(view({ wageBaseAmount: 1000000 }))
  await translating; await settle()
  expect(input('기본급(원)').props.value).toBe('2000000')
  api.patch.mockResolvedValueOnce({})
  api.get.mockResolvedValueOnce(view({ wageBaseAmount: 2000000 }))
  await button('저장').props.onClick(); await settle()
  expect(input('기본급(원)').props.value).toBe(2000000)
})

const mutationCases = [
  { name: 'draft', method: 'post', path: '/contract-draft', run: () => button('AI로 계약서 작성하기').props.onClick() },
  { name: 'translate', method: 'post', path: '/translate', run: () => child('onTranslate').props.onTranslate('en') },
  { name: 'link', method: 'post', path: '/link-previous', run: () => child('onLink').props.onLink('previous') },
  { name: 'unlink', method: 'delete', path: '/link-previous', run: () => child('onUnlink').props.onUnlink() },
  { name: 'end employment', method: 'post', path: '/employment-end', signed: true, run: () => child('onRecordEnd').props.onRecordEnd({ endedOn: '2026-09-19', reason: 'Synthetic ending' }) },
  { name: 'clear employment end', method: 'delete', path: '/employment-end', signed: true, run: () => child('onClearEnd').props.onClearEnd() },
  { name: 'confirm hire', method: 'post', path: '/confirm-hire', unconfirmed: true, run: () => button('채용 확정하기').props.onClick() },
  { name: 'change request', method: 'post', path: '/change-requests', candidate: true, run: () => child('onCreate').props.onCreate({ field: 'wageBaseAmount', requestedValue: '2000000', reason: 'Synthetic request' }) },
  { name: 'respond', method: 'post', path: '/change-requests/request', run: () => child('onRespond').props.onRespond('request', 'accept') },
  { name: 'sign', method: 'post', path: '/sign', run: () => {
    button('서명하기').props.onClick(); render()
    return walk(tree).find(node => node.type === SignatureModal).props.onSave('data:image/png;base64,AA==')
  } },
  { name: 'archive', method: 'upload', path: '/signed-contract', signed: true, run: () => button('계약서 저장 및 지원자에게 이메일 전송').props.onClick() },
]
it.each(mutationCases)('preserves confirmed $name success and uses GET-only recovery after refresh failure', async example => {
  const initial = view()
  if (example.signed) initial.room.status = 'signed'
  if (example.candidate) initial.room.myRole = 'candidate'
  if (example.unconfirmed) initial.contract.hireConfirmed = false
  await load(initial)
  api[example.method].mockResolvedValueOnce({ stored: { createdAt: '2026-09-19T00:00:00.000Z', emailStatus: 'not_sent' }, emailConfigured: false })
  api.get.mockRejectedValueOnce(new Error('Synthetic post-write read failure'))
  const result = await example.run(); await settle()
  expect(result).toBe(true)
  expect(api[example.method].mock.calls[0][0]).toBe(`/rooms/room${example.path}`)
  expect(toast.success).toHaveBeenCalledOnce()
  expect(toast.error).not.toHaveBeenCalled()
  expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('변경은 완료됐지만'))
  expect(text(tree)).toContain('이전에 확인한 자료')
  expect(button('PDF 다운로드').props.disabled).toBe(true)
  api.get.mockClear().mockResolvedValueOnce(initial)
  await button('계약서 다시 불러오기').props.onClick(); await settle()
  expect(api.get).toHaveBeenCalledExactlyOnceWith('/rooms/room/contract-view')
  expect(api[example.method]).toHaveBeenCalledOnce()
  expect(text(tree)).not.toContain('이전에 확인한 자료')
})

it('keeps child forms mounted and local edits while failed refreshes are retried', async () => {
  const initial = view()
  initial.room.myRole = 'candidate'
  await load(initial)
  const requestType = child('onCreate').type
  api.post.mockResolvedValueOnce({})
  api.get.mockRejectedValueOnce(new Error('Synthetic refresh failure'))
  const result = await child('onCreate').props.onCreate({ field: 'workLocation', requestedValue: 'Synthetic location', reason: '' })
  await settle()
  expect(result).toBe(true)
  expect(child('onCreate').type).toBe(requestType)
  expect(child('onCreate').props.canRequest).toBe(true)
  expect(child('onCreate').props.busy).toBe(true)
  const read = deferred()
  api.get.mockReturnValueOnce(read.promise)
  const retry = button('계약서 다시 불러오기').props.onClick(); render()
  expect(child('onCreate').type).toBe(requestType)
  expect(child('onCreate').props.canRequest).toBe(true)
  read.resolve(initial); await retry; await settle()
  expect(child('onCreate').props.busy).toBe(false)
})

it.each(['success', 'failure'])('ignores an older GET %s after a newer retry has finished', async outcome => {
  api.get.mockRejectedValueOnce(new Error('Initial read failure'))
  render(); await settle()
  const retry = button('계약서 다시 불러오기').props.onClick
  const old = deferred()
  api.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce(view({ wageBaseAmount: 2000000 }))
  const oldRequest = retry()
  await retry(); await settle()
  if (outcome === 'success') old.resolve(view({ wageBaseAmount: 1000000 }))
  else old.reject(new Error('Obsolete read failure'))
  await oldRequest; await settle()
  expect(input('기본급(원)').props.value).toBe(2000000)
  expect(button('계약서 다시 불러오기')).toBeUndefined()
})

it('invalidates the first StrictMode effect request before the effect is replayed', async () => {
  const first = deferred()
  api.get.mockReturnValueOnce(first.promise)
  render()
  const effect = host.cells.find(cell => typeof cell?.effect === 'function').effect
  host.cleanups[0]()
  api.get.mockResolvedValueOnce(view({ wageBaseAmount: 2000000 }))
  const cleanup = effect(); await settle()
  first.resolve(view({ wageBaseAmount: 1000000 })); await settle()
  expect(input('기본급(원)').props.value).toBe(2000000)
  cleanup(); host.dirty = false
  expect(host.dirty).toBe(false)
})

it.each(['success', 'failure'])('ignores an unmounted initial read %s', async outcome => {
  const request = deferred()
  api.get.mockReturnValueOnce(request.promise)
  render(); host.cleanups[0](); host.dirty = false
  if (outcome === 'success') request.resolve(view())
  else request.reject(new Error('Late initial read failure'))
  for (let count = 0; count < 20; count++) await Promise.resolve()
  expect(host.dirty).toBe(false)
  expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
})

it.each(['success', 'failure'])('does not toast, refresh, or update state after unmounted mutation %s', async outcome => {
  await load()
  const request = deferred()
  api.post.mockReturnValueOnce(request.promise)
  const translating = child('onTranslate').props.onTranslate('en'); render()
  host.cleanups[0](); host.dirty = false
  if (outcome === 'success') request.resolve({})
  else request.reject(new Error('Late write failure'))
  await translating
  expect(host.dirty).toBe(false)
  expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
  expect(api.get).toHaveBeenCalledOnce()
})

it('blocks same-tick duplicates and other writes until an uncertain outcome is reloaded', async () => {
  await load()
  const translate = child('onTranslate').props.onTranslate
  const save = button('저장').props.onClick
  const request = deferred()
  api.post.mockReturnValueOnce(request.promise)
  const first = translate('en')
  await translate('en'); await save()
  expect(api.post).toHaveBeenCalledOnce(); expect(api.patch).not.toHaveBeenCalled()
  request.reject(new Error('Unknown write result')); await first; await settle()
  await translate('en'); await save()
  expect(api.post).toHaveBeenCalledOnce(); expect(api.patch).not.toHaveBeenCalled()
  expect(button('계약서 다시 불러오기')).toBeDefined()
  api.get.mockResolvedValueOnce(view())
  await button('계약서 다시 불러오기').props.onClick(); await settle()
  api.post.mockResolvedValueOnce({}); api.get.mockResolvedValueOnce(view())
  await child('onTranslate').props.onTranslate('en'); await settle()
  expect(api.post).toHaveBeenCalledTimes(2)
})

it.each([408, 500, 503])('locks writes after an uncertain HTTP %s until GET verification', async status => {
  await load()
  const translate = child('onTranslate').props.onTranslate
  api.post.mockRejectedValueOnce(Object.assign(new Error('Uncertain server result'), { status }))
  await translate('en'); await settle()
  expect(button('저장').props.disabled).toBe(true)
  await translate('en')
  expect(api.post).toHaveBeenCalledOnce()
  api.get.mockResolvedValueOnce(view())
  await button('계약서 다시 불러오기').props.onClick(); await settle()
  expect(button('저장').props.disabled).toBe(false)
})

it('keeps edits available for correction after a definite input rejection', async () => {
  await load()
  input('기본급(원)').props.onChange({ target: { value: 'invalid' } }); render()
  api.patch.mockRejectedValueOnce(Object.assign(new Error('Input rejected'), { status: 400 }))
  await button('저장').props.onClick(); await settle()
  expect(button('저장').props.disabled).toBe(false)
  expect(input('기본급(원)').props.value).toBe('invalid')
  expect(api.get).toHaveBeenCalledOnce()
  expect(toast.success).not.toHaveBeenCalled()
})

it('does not clear editing or replace existing data with a malformed successful read', async () => {
  await load()
  input('기본급(원)').props.onChange({ target: { value: '2000000' } }); render()
  api.post.mockResolvedValueOnce({})
  api.get.mockResolvedValueOnce({ room: view().room, contract: {}, signatures: 'invalid' })
  await child('onTranslate').props.onTranslate('en'); await settle()
  expect(text(tree)).toContain('Synthetic contract')
  expect(input('기본급(원)').props.value).toBe('2000000')
  expect(walk(tree).find(node => node.type === UnsavedChangesGuard).props.when).toBe(true)
  expect(button('계약서 다시 불러오기')).toBeDefined()
})

it('does not let stale export handlers generate documents while the view is untrusted', async () => {
  await load()
  const exportPdf = button('PDF 다운로드').props.onClick
  api.post.mockResolvedValueOnce({}); api.get.mockRejectedValueOnce(new Error('Refresh failed'))
  await child('onTranslate').props.onTranslate('en'); await settle()
  await exportPdf()
  expect(pdfSave).not.toHaveBeenCalled()
})
