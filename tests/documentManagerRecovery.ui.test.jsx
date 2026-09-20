import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], cleanups: [], dirty: false }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
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
      host.cells[index] = { deps }; host.effects.push(effect)
    }
  },
}))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), upload: vi.fn(), delete: vi.fn() }, downloadApiFile: vi.fn() }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
import { api } from '../src/api/client.js'
import DocumentManager from '../src/components/DocumentManager.jsx'

let tree
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const button = label => walk(tree).find(node => node.type === 'button' && text(node) === label)
const inputs = () => walk(tree).filter(node => node.type === 'input')
const doc = { id: 'resume-id', docType: 'resume', filename: 'Previously loaded resume.pdf' }
const selected = () => ({ target: { files: [new File(['fixture'], 'same.pdf')], value: 'same.pdf' } })
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function render() {
  for (let count = 0; count < 10; count++) {
    host.index = 0; host.effects = []; host.dirty = false; tree = DocumentManager()
    for (const effect of host.effects) { const cleanup = effect(); if (typeof cleanup === 'function') host.cleanups.push(cleanup) }
    if (!host.dirty) return tree
  }
  throw new Error('render loop')
}
async function settle() { for (let count = 0; count < 12; count++) await Promise.resolve(); render() }
beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.cleanups = []; host.dirty = false
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External calls prohibited') }))
})
afterEach(() => vi.unstubAllGlobals())

it('separates initial loading and failure from a confirmed empty list, then retries only the GET', async () => {
  const request = deferred(); api.get.mockReturnValueOnce(request.promise)
  render()
  expect(text(tree)).toContain('서류 목록을 불러오는 중')
  expect(text(tree)).not.toContain('업로드된 파일 없음')
  expect(inputs().every(input => input.props.disabled)).toBe(true)
  request.reject(new Error('Network unavailable')); await settle()
  expect(text(tree)).toContain('서류 목록을 불러오지 못했습니다')
  expect(text(tree)).not.toContain('업로드된 파일 없음')
  api.get.mockResolvedValueOnce({ documents: [] })
  await button('서류 목록 다시 불러오기').props.onClick(); await settle()
  expect(text(tree)).toContain('업로드된 파일 없음')
  expect(inputs().every(input => !input.props.disabled)).toBe(true)
  expect(api.get.mock.calls).toEqual([['/documents/mine'], ['/documents/mine']])
  expect(api.upload).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled()
})

it.each(['upload', 'delete'])('retains an explicitly stale list after a confirmed %s and failed refresh, with GET-only recovery', async action => {
  api.get.mockResolvedValueOnce({ documents: [doc] }); render(); await settle()
  const staleUpload = inputs()[0].props.onChange, staleDelete = button('삭제').props.onClick
  api[action].mockResolvedValueOnce({ ok: true }); api.get.mockRejectedValueOnce(new Error('Refresh unavailable'))
  if (action === 'upload') await staleUpload(selected())
  else await staleDelete()
  await settle()
  expect(api[action]).toHaveBeenCalledOnce()
  expect(toast.success).toHaveBeenCalledWith(action === 'upload' ? '이력서 업로드가 완료되었습니다.' : '파일이 삭제되었습니다.')
  expect(toast.error).not.toHaveBeenCalled()
  expect(text(tree)).toContain(doc.filename)
  expect(text(tree)).toContain('이전에 불러온 서류 목록')
  expect(text(tree)).toContain('서류 목록을 불러오지 못했습니다')
  expect(inputs().every(input => input.props.disabled)).toBe(true)
  expect(button('삭제').props.disabled).toBe(true)
  // Even callbacks captured before React commits disabled state cannot mutate.
  await staleUpload(selected()); await staleDelete()
  expect(api.upload).toHaveBeenCalledTimes(action === 'upload' ? 1 : 0)
  expect(api.delete).toHaveBeenCalledTimes(action === 'delete' ? 1 : 0)
  api.get.mockResolvedValueOnce({ documents: [] })
  await button('서류 목록 다시 불러오기').props.onClick(); await settle()
  expect(api[action]).toHaveBeenCalledOnce()
  expect(text(tree)).not.toContain(doc.filename)
  expect(text(tree)).toContain('업로드된 파일 없음')
})

it('blocks duplicate and cross-document writes before rerender and clears the file input for the same file', async () => {
  api.get.mockResolvedValueOnce({ documents: [doc] }); render(); await settle()
  const upload = inputs()[0].props.onChange, otherUpload = inputs()[1].props.onChange, remove = button('삭제').props.onClick
  const pending = deferred(); api.upload.mockReturnValueOnce(pending.promise)
  const event = selected(); const first = upload(event)
  expect(event.target.value).toBe('')
  await upload(selected()); await otherUpload(selected()); await remove()
  expect(api.upload).toHaveBeenCalledOnce(); expect(api.delete).not.toHaveBeenCalled()
  render(); expect(inputs().every(input => input.props.disabled)).toBe(true)
  pending.resolve({ ok: true }); api.get.mockResolvedValueOnce({ documents: [doc] }); await first; await settle()
  api.upload.mockResolvedValueOnce({ ok: true }); api.get.mockResolvedValueOnce({ documents: [doc] })
  await inputs()[0].props.onChange(selected()); await settle()
  expect(api.upload).toHaveBeenCalledTimes(2)
})

it('does not automatically repeat an uncertain write and requires a read before another mutation', async () => {
  api.get.mockResolvedValueOnce({ documents: [doc] }); render(); await settle()
  api.delete.mockRejectedValueOnce(new Error('Write response lost'))
  await button('삭제').props.onClick(); await settle()
  expect(api.get).toHaveBeenCalledOnce()
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledWith('Write response lost')
  expect(inputs().every(input => input.props.disabled)).toBe(true)
  api.get.mockResolvedValueOnce({ documents: [] })
  await button('서류 목록 다시 불러오기').props.onClick(); await settle()
  expect(api.delete).toHaveBeenCalledOnce()
})

it.each(['success', 'failure'])('discards an older retry %s after the newest list resolves', async outcome => {
  api.get.mockRejectedValueOnce(new Error('Initial failure')); render(); await settle()
  const retry = button('서류 목록 다시 불러오기').props.onClick
  const old = deferred(), latest = deferred(); api.get.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
  const first = retry(), second = retry()
  latest.resolve({ documents: [doc] }); await second; await settle()
  if (outcome === 'success') old.resolve({ documents: [] })
  else old.reject(new Error('Stale read failure'))
  await first; await settle()
  expect(text(tree)).toContain(doc.filename)
  expect(text(tree)).not.toContain('서류 목록을 불러오지 못했습니다')
  expect(api.upload).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled()
})

it('does not update state after unmount while a list is pending', async () => {
  const pending = deferred(); api.get.mockReturnValueOnce(pending.promise); render()
  host.cleanups.forEach(cleanup => cleanup()); host.dirty = false
  pending.resolve({ documents: [doc] }); for (let count = 0; count < 12; count++) await Promise.resolve()
  expect(host.dirty).toBe(false)
})

it.each(['success', 'failure'])('does not toast, refresh, or update after unmount during upload %s', async outcome => {
  api.get.mockResolvedValueOnce({ documents: [] }); render(); await settle()
  const pending = deferred(); api.upload.mockReturnValueOnce(pending.promise)
  const operation = inputs()[0].props.onChange(selected())
  host.cleanups.forEach(cleanup => cleanup()); host.dirty = false
  if (outcome === 'success') pending.resolve({ ok: true })
  else pending.reject(new Error('Late failure'))
  await operation
  expect(host.dirty).toBe(false)
  expect(api.get).toHaveBeenCalledOnce()
  expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
})
