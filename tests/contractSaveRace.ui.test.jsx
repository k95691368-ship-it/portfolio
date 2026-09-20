import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('react', async original => ({
  ...await original(),
  useState(initial) {
    const index = host.index++
    const cell = host.cells[index] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, value => {
      cell.value = typeof value === 'function' ? value(cell.value) : value
      host.dirty = true
    }]
  },
  useRef(value) { return host.cells[host.index++] ||= { current: value } },
  useCallback(callback, deps) {
    const index = host.index++
    if (!host.cells[index] || deps.some((value, i) => !Object.is(value, host.cells[index].deps[i]))) {
      host.cells[index] = { deps, callback }
    }
    return host.cells[index].callback
  },
  useEffect(effect, deps) {
    const index = host.index++
    if (!host.cells[index] || deps.some((value, i) => !Object.is(value, host.cells[index].deps[i]))) {
      host.cells[index] = { deps }
      host.effects.push(effect)
    }
  },
}))
vi.mock('react-router-dom', () => ({ Link: 'test-link', useParams: () => ({ roomId: 'room' }) }))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), patch: vi.fn() }, downloadApiFile: vi.fn() }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'owner', isRecruiter: true } }) }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))

import { api } from '../src/api/client.js'
import ContractPage from '../src/pages/ContractPage.jsx'
import UnsavedChangesGuard from '../src/components/UnsavedChangesGuard.jsx'

let tree
const walk = node => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? ''
  : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const input = label => walk(walk(tree).find(node => node.type === 'label' && text(node) === label))
  .find(node => node.type === 'input')
const namedInput = label => walk(tree).find(node => node.type === 'input' && node.props['aria-label'] === label)
const saveButton = () => walk(tree).find(node => node.type === 'button' && text(node) === '저장')
const guarded = () => walk(tree).find(node => node.type === UnsavedChangesGuard).props.when
function render() {
  for (let count = 0; count < 10; count++) {
    host.index = 0; host.effects = []; host.dirty = false
    tree = ContractPage()
    for (const effect of host.effects) effect()
    if (!host.dirty) return tree
  }
  throw new Error('render loop')
}
async function settle() { for (let count = 0; count < 12; count++) await Promise.resolve(); render() }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const view = terms => ({
  room: { id: 'room', title: 'Synthetic contract', status: 'open', myRole: 'company', participants: [] },
  contract: { terms, hireConfirmed: true, updatedAt: '2026-09-19T00:00:00.000Z' },
  signatures: [], history: [],
})
async function load(terms = {}) {
  api.get.mockResolvedValueOnce(view(terms))
  render(); await settle()
}
function change(label, value) { input(label).props.onChange({ target: { value } }); render() }

beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.dirty = false
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No external calls allowed in this test') }))
})
afterEach(() => vi.unstubAllGlobals())

it('retains newer field edits and the navigation guard after an earlier save completes', async () => {
  await load({ wageBaseAmount: 1000000 })
  change('기본급(원)', '2000000')
  const request = deferred()
  api.patch.mockReturnValueOnce(request.promise)
  api.get.mockImplementationOnce(async () => view(api.patch.mock.calls[0][1]))
  const saving = saveButton().props.onClick(); render()
  change('기본급(원)', '3000000')
  request.resolve({}); await saving; await settle()
  expect(api.patch.mock.calls[0][1].wageBaseAmount).toBe(2000000)
  expect(input('기본급(원)').props.value).toBe('3000000')
  expect(guarded()).toBe(true)
  expect(toast.success).toHaveBeenLastCalledWith('요청 당시 내용은 저장됐고 이후 입력은 아직 저장되지 않았습니다.')

  api.patch.mockResolvedValueOnce({})
  api.get.mockImplementationOnce(async () => view(api.patch.mock.lastCall[1]))
  await saveButton().props.onClick(); await settle()
  expect(api.patch.mock.lastCall[1].wageBaseAmount).toBe(3000000)
  expect(input('기본급(원)').props.value).toBe(3000000)
  expect(guarded()).toBe(false)
  expect(toast.success).toHaveBeenLastCalledWith('정상적으로 저장되었습니다.')
})

it('does not replace a custom term edited while the save request is in flight', async () => {
  await load({ customTerms: [{ label: '기타 조건', value: '기존 조건' }] })
  namedInput('1번 그 밖의 사항 내용').props.onChange({ target: { value: '저장할 조건' } }); render()
  const request = deferred()
  api.patch.mockReturnValueOnce(request.promise)
  api.get.mockImplementationOnce(async () => view(api.patch.mock.calls[0][1]))
  const saving = saveButton().props.onClick(); render()
  namedInput('1번 그 밖의 사항 내용').props.onChange({ target: { value: '추가 작성 중인 조건' } }); render()
  request.resolve({}); await saving; await settle()
  expect(api.patch.mock.calls[0][1].customTerms).toEqual([{ label: '기타 조건', value: '저장할 조건' }])
  expect(namedInput('1번 그 밖의 사항 내용').props.value).toBe('추가 작성 중인 조건')
  expect(guarded()).toBe(true)
  expect(toast.success).toHaveBeenLastCalledWith('요청 당시 내용은 저장됐고 이후 입력은 아직 저장되지 않았습니다.')
})

it('preserves input entered while the post-save refresh is delayed', async () => {
  await load({ wageBaseAmount: 1000000 })
  change('기본급(원)', '2000000')
  const refresh = deferred()
  api.patch.mockResolvedValueOnce({})
  api.get.mockReturnValueOnce(refresh.promise)
  const saving = saveButton().props.onClick(); await settle()
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(toast.success).toHaveBeenLastCalledWith('정상적으로 저장되었습니다.')
  change('기본급(원)', '3000000')
  refresh.resolve(view(api.patch.mock.calls[0][1])); await saving; await settle()
  expect(input('기본급(원)').props.value).toBe('3000000')
  expect(guarded()).toBe(true)
  expect(toast.success).toHaveBeenLastCalledWith('정상적으로 저장되었습니다.')
})

it('retains newer input as unsaved even when the successful save cannot be reloaded', async () => {
  await load({ wageBaseAmount: 1000000 })
  change('기본급(원)', '2000000')
  const request = deferred()
  api.patch.mockReturnValueOnce(request.promise)
  api.get.mockRejectedValueOnce(new Error('Refresh unavailable'))
  const saving = saveButton().props.onClick(); render()
  change('기본급(원)', '3000000')
  request.resolve({}); await saving; await settle()
  expect(input('기본급(원)').props.value).toBe('3000000')
  expect(guarded()).toBe(true)
  expect(toast.error).not.toHaveBeenCalled()
  expect(toast.success).toHaveBeenCalledWith('요청 당시 내용은 저장됐고 이후 입력은 아직 저장되지 않았습니다.')
  expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('저장은 완료됐지만'))
})

it('keeps the original saved baseline and edits when the save itself is rejected', async () => {
  await load({ wageBaseAmount: 1000000 })
  change('기본급(원)', '2000000')
  const request = deferred()
  api.patch.mockReturnValueOnce(request.promise)
  const saving = saveButton().props.onClick(); render()
  change('기본급(원)', '3000000')
  request.reject(new Error('Save unavailable')); await saving; await settle()
  expect(input('기본급(원)').props.value).toBe('3000000')
  expect(guarded()).toBe(true)
  expect(api.get).toHaveBeenCalledOnce()
  expect(toast.error).toHaveBeenCalledWith('Save unavailable')
  change('기본급(원)', 1000000)
  expect(guarded()).toBe(false)
})

it('normalizes the submitted snapshot and clears the guard when there are no newer edits', async () => {
  await load({
    customTerms: [{ label: '기타 조건', value: '유지할 조건' }, { label: '', value: '' }],
    wageItems: [{ name: '식대', amount: '100000' }, { name: '', amount: '' }],
  })
  change('기본급(원)', '2000000')
  api.patch.mockResolvedValueOnce({})
  api.get.mockImplementationOnce(async () => view(api.patch.mock.calls[0][1]))
  await saveButton().props.onClick(); await settle()
  expect(api.patch.mock.calls[0][1]).toMatchObject({
    wageBaseAmount: 2000000,
    customTerms: [{ label: '기타 조건', value: '유지할 조건' }],
    wageItems: [{ name: '식대', amount: 100000 }],
  })
  expect(input('기본급(원)').props.value).toBe(2000000)
  expect(namedInput('2번 그 밖의 사항 내용')).toBeUndefined()
  expect(guarded()).toBe(false)
  expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('기타 항목 1개'))
})
