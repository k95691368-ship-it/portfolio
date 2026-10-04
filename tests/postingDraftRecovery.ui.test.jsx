import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

// Actual page handlers plus the actual private-draft SQL routes. Hook lifetimes
// and transport failures are controlled; no real mailbox or database is used.
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
vi.mock('react-router-dom', () => ({ Link: 'test-link', useNavigate: () => vi.fn() }))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }, downloadApiFile: vi.fn(), markRoomDoor: vi.fn() }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'author', role: 'company', isRecruiter: true } }) }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }))
import { api } from '../src/api/client.js'
import RecruitPage from '../src/pages/RecruitPage.jsx'
import { onRequestGet as list } from '../server/api/posting-drafts/index.js'
import { onRequestGet as get, onRequestPut as save } from '../server/api/posting-drafts/[id].js'

let sql, env, tree
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const button = label => walk(tree).find(node => node.type === 'button' && text(node) === label)
const title = () => walk(walk(tree).find(node => node.type === 'label' && text(node).replace('*', '').trim() === '공고 제목')).find(node => node.type === 'input')
const fields = () => walk(tree).find(node => node.type === 'fieldset' && node.props.className === 'posting-draft-fields')
function render() {
  for (let i = 0; i < 15; i++) {
    host.index = 0; host.effects = []; host.dirty = false
    tree = RecruitPage()
    for (const effect of host.effects) effect()
    if (!host.dirty) return
  }
  throw new Error('Page did not settle')
}
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); render() }
async function decoded(response) {
  response = await response
  const data = await response.json()
  if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status })
  return data
}
const context = (id, body) => ({ env, data: { user: { id: 'author', is_recruiter: 1 } }, params: { id },
  request: new Request('https://test.invalid', { method: 'PUT', body: JSON.stringify(body ?? {}) }) })
const read = path => path === '/posting-drafts' ? decoded(list(context()))
  : path.startsWith('/posting-drafts/') ? decoded(get(context(path.split('/').at(-1))))
    : Promise.resolve(path === '/postings' ? { postings: [] } : { applications: [] })
const put = (path, body) => decoded(save(context(path.split('/').at(-1), body)))
const lose = status => Object.assign(new Error('Synthetic response unavailable'), status ? { status } : {})
async function mount() { render(); await settle(); title().props.onChange({ target: { value: '첫 합성 초안' } }); render() }
const count = () => Number(sql.prepare('SELECT count(*) AS n FROM posting_drafts').get().n)
const stored = () => sql.prepare('SELECT * FROM posting_drafts').get()

beforeEach(() => {
  vi.resetAllMocks(); host.cells = []; host.index = 0; host.effects = []; host.dirty = false
  vi.stubGlobal('window', { confirm: vi.fn(() => true) })
  sql = new DatabaseSync(':memory:')
  sql.exec("CREATE TABLE users (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('author')")
  const migration = readFileSync(new URL('../supabase/migrations/202609120002_posting_drafts.sql', import.meta.url), 'utf8')
  sql.exec(migration.replaceAll('public.', '').replace(/ALTER TABLE[^;]+;/g, '').replace(/REVOKE[^;]+;/g, ''))
  env = { DB: { prepare(query) {
    let values = []
    const statement = { bind(...args) { values = args; return statement },
      async first() { return sql.prepare(query).get(...values) ?? null },
      async all() { return { results: sql.prepare(query).all(...values) } },
      async run() { return { meta: { changes: Number(sql.prepare(query).run(...values).changes) } } },
    }
    return statement
  } } }
  api.get.mockImplementation(read); api.put.mockImplementation(put)
})
afterEach(() => { for (const cell of host.cells) cell.cleanup?.(); sql.close(); vi.unstubAllGlobals() })

describe('private posting draft response recovery', () => {
  it('confirms a committed lost PUT by GET and allows the next edit with the stored revision', async () => {
    await mount()
    api.put.mockImplementationOnce(async (...args) => { await put(...args); throw lose() })
    await button('임시저장').props.onClick(); await settle()
    expect(title().props.value).toBe('첫 합성 초안')
    title().props.onChange({ target: { value: '다음 합성 편집' } }); render()
    await button('임시저장').props.onClick(); await settle()
    expect(api.put.mock.calls[1][1].revision).toBe(1)
    expect(JSON.parse(stored().payload).title).toBe('다음 합성 편집')
    expect(stored().revision).toBe(2); expect(count()).toBe(1)
    expect(api.get.mock.calls.some(([path]) => path.startsWith('/posting-drafts/'))).toBe(true)
    expect(api.post).not.toHaveBeenCalled()
  })

  it('preserves input and permits a GET-only retry if immediate confirmation also fails', async () => {
    await mount()
    api.put.mockImplementationOnce(async (...args) => { await put(...args); throw lose(503) })
    api.get.mockImplementation(path => path.startsWith('/posting-drafts/') ? Promise.reject(lose(503)) : read(path))
    await button('임시저장').props.onClick(); await settle()
    expect(text(tree)).toContain('임시저장 결과를 확인하지 못했습니다')
    expect(title().props.value).toBe('첫 합성 초안')
    title().props.onChange({ target: { value: '확인 대기 중 편집' } }); render()
    api.get.mockImplementation(read)
    await button('임시저장 상태 확인').props.onClick(); await settle()
    expect(api.put).toHaveBeenCalledTimes(1)
    expect(title().props.value).toBe('확인 대기 중 편집')
    expect(text(tree)).toContain('저장하지 않은 변경사항')
    await button('임시저장').props.onClick(); await settle()
    expect(api.put.mock.calls[1][1].revision).toBe(1)
    expect(JSON.parse(stored().payload).title).toBe('확인 대기 중 편집')
    expect(api.post).not.toHaveBeenCalled()
  })

  it('does not replace local input or adopt a different saved draft as this save', async () => {
    await mount()
    api.put.mockImplementationOnce(async (path, body) => {
      await put(path, body); await put(path, { fields: { ...body.fields, title: '다른 창의 새 초안' }, revision: 1 }); throw lose()
    })
    await button('임시저장').props.onClick(); await settle()
    expect(text(tree)).toContain('저장된 초안의 내용이 이번 요청과 다릅니다')
    expect(title().props.value).toBe('첫 합성 초안')
    expect(JSON.parse(stored().payload).title).toBe('다른 창의 새 초안')
    expect(api.put).toHaveBeenCalledTimes(1)
    expect(api.post).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps the usual successful save and does not add a detail GET', async () => {
    await mount(); await button('임시저장').props.onClick(); await settle()
    expect(count()).toBe(1); expect(stored().revision).toBe(1)
    expect(api.get.mock.calls.filter(([path]) => path.startsWith('/posting-drafts/'))).toHaveLength(0)
    expect(toast.success).toHaveBeenCalledWith('임시저장했습니다. 공고는 아직 공개되지 않습니다.')
    expect(fields().props.disabled).toBe(false)
  })

  it.each([400, 401, 403, 409, 429])('retains a definite %s rejection without treating it as a committed save', async status => {
    await mount(); api.put.mockRejectedValueOnce(lose(status))
    await button('임시저장').props.onClick(); await settle()
    expect(count()).toBe(0)
    expect(title().props.value).toBe('첫 합성 초안')
    expect(api.get.mock.calls.filter(([path]) => path.startsWith('/posting-drafts/'))).toHaveLength(0)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('coalesces repeated save handlers before the disabled state renders', async () => {
    await mount()
    const action = button('임시저장').props.onClick
    await Promise.all([action(), action()]); await settle()
    expect(api.put).toHaveBeenCalledTimes(1)
    expect(count()).toBe(1)
  })

  it('recovers an invalid success response by reading the saved snapshot, not by inventing success', async () => {
    await mount()
    api.put.mockImplementationOnce(async (...args) => { await put(...args); return {} })
    await button('임시저장').props.onClick(); await settle()
    expect(toast.success).not.toHaveBeenCalledWith('임시저장했습니다. 공고는 아직 공개되지 않습니다.')
    expect(toast.success).toHaveBeenCalledWith('임시저장된 내용을 확인했습니다. 현재 입력은 그대로 보존했습니다.')
    expect(api.put).toHaveBeenCalledTimes(1); expect(count()).toBe(1)
    expect(button('임시저장').props.disabled).toBe(false)
  })

  it.each(['id', 'revision', 'fields', 'updatedAt'])('refuses an unverified %s on the recovery response', async key => {
    await mount()
    api.put.mockImplementationOnce(async (...args) => { await put(...args); throw lose() })
    api.get.mockImplementation(async path => {
      const result = await read(path)
      if (!path.startsWith('/posting-drafts/')) return result
      const replacement = { id: 'different-id', revision: 8, fields: {}, updatedAt: null }
      return { draft: { ...result.draft, [key]: replacement[key] } }
    })
    await button('임시저장').props.onClick(); await settle()
    expect(toast.success).not.toHaveBeenCalled()
    expect(button('임시저장').props.disabled).toBe(true)
    expect(button('공고 등록').props.disabled).toBe(true)
    await walk(tree).find(node => node.type === 'form' && node.props.id === 'new-posting-form').props.onSubmit({ preventDefault() {} })
    expect(api.post).not.toHaveBeenCalled()
    expect(title().props.value).toBe('첫 합성 초안')
    expect(count()).toBe(1)
  })

  it('keeps a missing draft uncertain and requires explicit confirmation before abandoning the local operation', async () => {
    await mount(); api.put.mockRejectedValueOnce(lose())
    await button('임시저장').props.onClick(); await settle()
    expect(count()).toBe(0); expect(toast.success).not.toHaveBeenCalled()
    expect(text(tree)).toContain('임시저장 결과를 확인하지 못했습니다')
    window.confirm.mockReturnValueOnce(false)
    button('새 공고 작성').props.onClick(); render()
    expect(title().props.value).toBe('첫 합성 초안')
    expect(button('임시저장').props.disabled).toBe(true)
    button('새 공고 작성').props.onClick(); render()
    expect(title().props.value).toBe('')
    expect(button('임시저장').props.disabled).toBe(false)
    expect(button('임시저장 상태 확인')).toBeUndefined()
    expect(api.put).toHaveBeenCalledTimes(1)
  })

  it('coalesces repeated manual GET checks and preserves edits made before checking', async () => {
    await mount()
    api.put.mockImplementationOnce(async (...args) => { await put(...args); throw lose() })
    api.get.mockImplementation(path => path.startsWith('/posting-drafts/') ? Promise.reject(lose()) : read(path))
    await button('임시저장').props.onClick(); await settle()
    title().props.onChange({ target: { value: '복구 대기 중 다음 편집' } }); render()
    let complete
    api.get.mockImplementation(path => path.startsWith('/posting-drafts/')
      ? new Promise(resolve => { complete = async () => resolve(await read(path)) }) : read(path))
    const action = button('임시저장 상태 확인').props.onClick
    const first = action(); const second = action(); render()
    expect(fields().props.disabled).toBe(true)
    expect(api.get.mock.calls.filter(([path]) => path.startsWith('/posting-drafts/'))).toHaveLength(2)
    await complete(); await Promise.all([first, second]); await settle()
    expect(title().props.value).toBe('복구 대기 중 다음 편집')
    expect(text(tree)).toContain('저장하지 않은 변경사항')
    expect(api.put).toHaveBeenCalledTimes(1)
  })

  it('does not query automatically as a newer login after a stale-auth response', async () => {
    await mount()
    api.put.mockImplementationOnce(async (...args) => { await put(...args); throw Object.assign(lose(401), { code: 'STALE_AUTH_RESPONSE' }) })
    await button('임시저장').props.onClick(); await settle()
    expect(count()).toBe(1)
    expect(api.get.mock.calls.filter(([path]) => path.startsWith('/posting-drafts/'))).toHaveLength(0)
    expect(button('임시저장').props.disabled).toBe(true)
    expect(button('임시저장 상태 확인')).toBeDefined()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('ignores a late save response after the page lifetime ends', async () => {
    await mount()
    let complete
    api.put.mockImplementationOnce((...args) => new Promise(resolve => { complete = async () => resolve(await put(...args)) }))
    const pending = button('임시저장').props.onClick()
    for (const cell of host.cells) cell.cleanup?.()
    const previousReads = api.get.mock.calls.length
    await complete(); await pending
    expect(count()).toBe(1)
    expect(api.get).toHaveBeenCalledTimes(previousReads)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('aborts and ignores a late confirmation after the page lifetime ends', async () => {
    await mount()
    api.put.mockImplementationOnce(async (...args) => { await put(...args); throw lose() })
    let complete, signal
    api.get.mockImplementation((path, options) => path.startsWith('/posting-drafts/')
      ? new Promise(resolve => { signal = options.signal; complete = async () => resolve(await read(path)) }) : read(path))
    const pending = button('임시저장').props.onClick()
    for (let i = 0; i < 30 && !complete; i++) await Promise.resolve()
    expect(complete).toBeDefined()
    for (const cell of host.cells) cell.cleanup?.()
    expect(signal.aborted).toBe(true)
    await complete(); await pending
    expect(count()).toBe(1)
    expect(toast.success).not.toHaveBeenCalled()
    expect(api.put).toHaveBeenCalledTimes(1)
  })
})
