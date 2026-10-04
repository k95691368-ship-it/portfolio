import { beforeEach, describe, expect, it, vi } from 'vitest'

// Run the real form handlers with synthetic hook state, without browser/network writes.
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false, updates: 0 }))
vi.mock('react', async original => ({
  ...await original(),
  useState(initial) {
    const index = host.index++
    const cell = host.cells[index] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, value => {
      cell.value = typeof value === 'function' ? value(cell.value) : value
      host.dirty = true
      host.updates++
    }]
  },
  useEffect(effect, deps) {
    const index = host.index++
    const cell = host.cells[index]
    if (!cell || deps.some((value, i) => !Object.is(value, cell.deps[i]))) {
      const next = { deps, effect, cleanup: cell?.cleanup }
      host.cells[index] = next
      host.effects.push(next)
    }
  },
}))

import ChangeRequests from '../src/components/contract/ChangeRequests.jsx'

const walk = node => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? ''
  : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const input = (tree, label) => walk(walk(tree).find(node => node.type === 'label' && text(node).startsWith(label)))
  .find(node => node.type === 'input' || node.type === 'select')
const form = tree => walk(tree).find(node => node.type === 'form')
const labels = ['항목', '요청하는 값', '사유 (선택)']
const first = { field: 'workLocation', requestedValue: 'First request', reason: 'First reason' }
const next = { field: 'jobDescription', requestedValue: 'Next draft', reason: 'Next reason' }
const values = draft => [draft.field, draft.requestedValue, draft.reason]
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const propsFor = onCreate => ({
  requests: [], myRole: 'candidate', canRequest: true, canRespond: false,
  onCreate, onRespond: vi.fn(), busy: false, prefill: null,
})

function render(props) {
  for (let count = 0; count < 10; count++) {
    host.index = 0; host.effects = []; host.dirty = false
    const tree = ChangeRequests(props)
    for (const cell of host.effects) {
      cell.cleanup?.()
      cell.cleanup = cell.effect()
    }
    if (!host.dirty) return tree
  }
  throw new Error('Change request form did not settle')
}
function fill(props, draft) {
  let tree = render(props)
  for (const [index, value] of values(draft).entries()) {
    input(tree, labels[index]).props.onChange({ target: { value } })
    tree = render(props)
  }
  return tree
}
const readDraft = tree => labels.map(label => input(tree, label).props.value)
const submit = tree => form(tree).props.onSubmit({ preventDefault() {} })
function cleanup() {
  for (const cell of host.cells) cell.cleanup?.()
}
function replayEffects() {
  cleanup()
  for (const cell of host.cells) {
    if (cell.effect) cell.cleanup = cell.effect()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  host.cells = []; host.index = 0; host.effects = []; host.dirty = false; host.updates = 0
})

describe('change request submission preserves the current draft', () => {
  it.each([true, false])('keeps unchanged-draft success/failure behavior: %s', async sent => {
    const pending = deferred()
    const onCreate = vi.fn(() => pending.promise)
    const props = propsFor(onCreate)
    const task = submit(fill(props, first))
    pending.resolve(sent)
    await task
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(first)
    expect(readDraft(render(props))).toEqual(sent ? ['', '', ''] : values(first))
  })

  it.each(labels)('preserves a later edit to %s after the earlier request succeeds', async label => {
    const pending = deferred()
    const onCreate = vi.fn(() => pending.promise)
    const props = propsFor(onCreate)
    const task = submit(fill(props, first))
    props.busy = true
    const tree = render(props)
    expect(input(tree, label).props.disabled).not.toBe(true)
    input(tree, label).props.onChange({ target: { value: values(next)[labels.indexOf(label)] } })
    const expected = values(first)
    expected[labels.indexOf(label)] = values(next)[labels.indexOf(label)]
    pending.resolve(true)
    await task
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(first)
    expect(readDraft(render(props))).toEqual(expected)
  })

  it('does not require a rerender to preserve edits queued before completion', async () => {
    const pending = deferred()
    const props = propsFor(vi.fn(() => pending.promise))
    const tree = fill(props, first)
    const task = submit(tree)
    input(tree, '요청하는 값').props.onChange({ target: { value: next.requestedValue } })
    pending.resolve(true)
    await task
    expect(readDraft(render(props))).toEqual([first.field, next.requestedValue, first.reason])
  })

  it.each([true, false])('preserves the next complete draft while request A resolves: %s', async sent => {
    const pending = deferred()
    const props = propsFor(vi.fn(() => pending.promise))
    const task = submit(fill(props, first))
    fill(props, next)
    pending.resolve(sent)
    await task
    expect(readDraft(render(props))).toEqual(values(next))
  })

  it('preserves a new check-result prefill arriving during the request', async () => {
    const pending = deferred()
    const props = propsFor(vi.fn(() => pending.promise))
    const task = submit(fill(props, first))
    props.prefill = next
    render(props)
    pending.resolve(true)
    await task
    expect(readDraft(render(props))).toEqual(values(next))
  })

  it('blocks same-tick duplicate submissions and allows the new draft after completion', async () => {
    const pending = deferred()
    const onCreate = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(true)
    const props = propsFor(onCreate)
    const tree = fill(props, first)
    const firstTask = submit(tree)
    const duplicate = submit(tree)
    expect(onCreate).toHaveBeenCalledExactlyOnceWith(first)
    fill(props, next)
    pending.resolve(true)
    await Promise.all([firstTask, duplicate])
    expect(readDraft(render(props))).toEqual(values(next))
    await submit(render(props))
    expect(onCreate.mock.calls).toEqual([[first], [next]])
    expect(readDraft(render(props))).toEqual(['', '', ''])
  })

  it('releases the submission guard after rejection without clearing input', async () => {
    const pending = deferred()
    const error = new Error('synthetic callback failure')
    const onCreate = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(true)
    const props = propsFor(onCreate)
    const task = submit(fill(props, first))
    const rejected = expect(task).rejects.toBe(error)
    fill(props, next)
    pending.reject(error)
    await rejected
    expect(readDraft(render(props))).toEqual(values(next))
    await submit(render(props))
    expect(onCreate.mock.calls).toEqual([[first], [next]])
    expect(readDraft(render(props))).toEqual(['', '', ''])
  })

  it('allows a retry of the preserved draft after a definite failure', async () => {
    const onCreate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const props = propsFor(onCreate)
    await submit(fill(props, first))
    expect(readDraft(render(props))).toEqual(values(first))
    await submit(render(props))
    expect(onCreate.mock.calls).toEqual([[first], [first]])
    expect(readDraft(render(props))).toEqual(['', '', ''])
  })

  it('does not start a request through the form handler when the parent is busy', async () => {
    const onCreate = vi.fn().mockResolvedValue(true)
    const props = propsFor(onCreate)
    fill(props, first)
    props.busy = true
    await submit(render(props))
    expect(onCreate).not.toHaveBeenCalled()
    expect(readDraft(render(props))).toEqual(values(first))
  })

  it('does not update disposed input state after an old request succeeds', async () => {
    const pending = deferred()
    const props = propsFor(vi.fn(() => pending.promise))
    const task = submit(fill(props, first))
    fill(props, next)
    cleanup()
    const updates = host.updates
    pending.resolve(true)
    await task
    expect(host.updates).toBe(updates)
    expect(readDraft(render(props))).toEqual(values(next))
  })

  it('does not start a request through a handler belonging to a disposed form', async () => {
    const onCreate = vi.fn().mockResolvedValue(true)
    const props = propsFor(onCreate)
    const tree = fill(props, first)
    cleanup()
    await submit(tree)
    expect(onCreate).not.toHaveBeenCalled()
    expect(readDraft(render(props))).toEqual(values(first))
  })

  it('keeps a remounted form draft independent of a disposed request', async () => {
    const pending = deferred()
    const oldProps = propsFor(vi.fn(() => pending.promise))
    const task = submit(fill(oldProps, first))
    cleanup()
    host.cells = []
    const props = propsFor(vi.fn())
    fill(props, next)
    const updates = host.updates
    pending.resolve(true)
    await task
    expect(host.updates).toBe(updates)
    expect(readDraft(render(props))).toEqual(values(next))
    expect(props.onCreate).not.toHaveBeenCalled()
  })

  it('invalidates the old attempt during effect replay without unlocking the new pending attempt', async () => {
    const firstPending = deferred()
    const nextPending = deferred()
    const onCreate = vi.fn().mockImplementationOnce(() => firstPending.promise).mockImplementationOnce(() => nextPending.promise)
    const props = propsFor(onCreate)
    const firstTask = submit(fill(props, first))
    replayEffects()
    const nextTree = fill(props, next)
    const nextTask = submit(nextTree)
    const updates = host.updates
    firstPending.resolve(true)
    await firstTask
    expect(host.updates).toBe(updates)
    expect(readDraft(render(props))).toEqual(values(next))
    await submit(render(props))
    expect(onCreate.mock.calls).toEqual([[first], [next]])
    nextPending.resolve(true)
    await nextTask
    expect(readDraft(render(props))).toEqual(['', '', ''])
  })
})
