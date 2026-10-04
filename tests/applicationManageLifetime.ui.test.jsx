import { beforeEach, afterEach, it, expect, vi } from 'vitest'

const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false, writes: 0 }))
vi.mock('react', async original => ({
  ...await original(),
  useState(initial) {
    const cell = host.cells[host.index++] ||= { value: typeof initial === 'function' ? initial() : initial }
    return [cell.value, value => {
      cell.value = typeof value === 'function' ? value(cell.value) : value
      host.dirty = true; host.writes++
    }]
  },
  useRef(initial) { return host.cells[host.index++] ||= { current: initial } },
  useEffect(effect, deps) {
    const index = host.index++
    const previous = host.cells[index]
    if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) {
      previous?.cleanup?.()
      const cell = host.cells[index] = { deps, effect }
      host.effects.push(() => { cell.cleanup = effect() })
    }
  },
}))
vi.mock('react-router-dom', () => ({ Link: 'test-link' }))
vi.mock('../src/components/UnsavedChangesGuard.jsx', () => ({ default: 'test-guard' }))
vi.mock('../src/components/Modal.jsx', () => ({ default: 'test-modal' }))

// Keep both clients real: a normal account login changes the revision checked
// by the separate email-proof client. Only transport and hook hosting are fake.
let Page, service, client, tree, sessionRows, responses, requests
const summary = { id: 'app', postingTitle: 'Synthetic role', status: 'submitted', lookupCode: 'ABCD2345EF', createdAt: '2026-10-01T00:00:00Z' }
const application = extra => ({
  ...summary, postingId: 'posting', revision: 0, applicantName: 'Synthetic applicant',
  applicantEmail: 'candidate@example.invalid', applicantPhone: '010-0000-0000',
  career: [], applicationSource: '', coverLetter: '', consentOptional: false,
  canEdit: true, canWithdraw: true, documents: [{ id: 'doc', filename: 'resume.pdf' }], ...extra,
})
const proof = () => ({ token: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const respond = (method, path, response) => {
  const key = `${method} /api${path}`
  if (!responses.has(key)) responses.set(key, [])
  responses.get(key).push(response)
}
const httpError = (status, error) => Response.json({ error }, { status })
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(walk) : [node, ...walk(node.props?.children)]
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object'
  ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children)
const field = test => walk(tree).find(test)
const button = label => field(node => node.type === 'button' && text(node).includes(label))
const form = () => field(node => node.type === 'form' && node.props.className.includes('application-edit-form'))
const count = (method, path) => requests.filter(request => request.method === method && request.path === `/api${path}`).length
function render() {
  for (let attempt = 0; attempt < 10; attempt++) {
    host.index = 0; host.effects = []; host.dirty = false
    tree = Page()
    for (const effect of host.effects) effect()
    if (!host.dirty) return
  }
  throw new Error('Synthetic render loop')
}
async function flush() { for (let turn = 0; turn < 30; turn++) await Promise.resolve() }
async function settle() { await flush(); render() }
function unmount() {
  for (const cell of host.cells) cell?.cleanup?.()
  host.cells = []; host.index = 0; host.effects = []; host.dirty = false
}
async function mount() { render(); await settle() }
async function openDetail() { button('제출 내용 보기').props.onClick(); await settle() }
function editDraft() {
  field(node => node.type === 'textarea').props.onChange({ target: { value: 'Draft to preserve' } })
  field(node => node.type === 'input' && node.props.type === 'file').props.onChange({
    target: { files: [new File(['%PDF-1.4'], 'replacement.pdf')] },
  })
  render()
}
async function login() { await client.api.post('/login', { email: 'candidate@example.invalid', password: 'synthetic-only', remember: false }) }

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  host.cells = []; host.index = 0; host.effects = []; host.writes = 0
  sessionRows = new Map(); responses = new Map(); requests = []
  const storage = rows => ({ getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, String(value)), removeItem: key => rows.delete(key) })
  vi.stubGlobal('sessionStorage', storage(sessionRows))
  vi.stubGlobal('localStorage', storage(new Map()))
  sessionStorage.setItem('portfolioApplicationAccess', JSON.stringify(proof()))
  vi.stubGlobal('window', {
    location: { hash: '', pathname: '/application-manage' },
    history: { state: {}, replaceState: vi.fn() }, confirm: vi.fn(() => true),
  })
  vi.stubGlobal('document', { createElement: vi.fn(() => ({ click: vi.fn() })) })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-only')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubEnv('VITE_API_BASE', '/api')
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    expect(String(url).startsWith('/api/'), 'All transport must remain a local in-memory substitute').toBe(true)
    const request = { method: options.method || 'GET', path: String(url), options }
    requests.push(request)
    const queued = responses.get(`${request.method} ${request.path}`)?.shift()
    if (queued !== undefined) return queued
    if (request.path === '/api/login') return Response.json({
      id: 'account', role: 'candidate', sessionToken: 'synthetic-account-session', sessionPersistent: false,
      sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    if (request.method === 'GET' && request.path === '/api/application-self-service') return Response.json({ applications: [summary] })
    if (request.method === 'GET' && request.path === '/api/application-self-service/app') return Response.json({ application: application() })
    throw new Error(`Unexpected synthetic request ${request.method} ${request.path}`)
  }))
  service = await import('../src/lib/applicationSelfService.js')
  client = await import('../src/api/client.js')
  Page = (await import('../src/pages/ApplicationManagePage.jsx')).default
})
afterEach(() => {
  unmount()
  vi.clearAllTimers(); vi.useRealTimers()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
})

it('control: keeps the email proof usable after a normal login and a new management-page mount', async () => {
  await mount(); unmount(); await login(); await mount()
  expect(client.getAccountAuthRevision()).toBe(1)
  expect(service.hasApplicationAccess()).toBe(true)
  await openDetail()
  expect(form()).toBeDefined()
  expect(count('POST', '/application-access/exchange')).toBe(0)
})

it('does not let the previous detail request end a valid email proof after normal login and route reentry', async () => {
  await mount()
  const old = deferred()
  respond('GET', '/application-self-service/app', old.promise)
  button('제출 내용 보기').props.onClick(); render()
  expect(field(node => node.type === 'test-guard').props.when).toBe(false)
  unmount(); await login(); await mount()
  expect(service.hasApplicationAccess()).toBe(true)
  const writes = host.writes
  old.resolve(Response.json({ application: application() })); await flush()
  expect(host.writes).toBe(writes)
  expect(service.hasApplicationAccess()).toBe(true)
  expect(JSON.parse(sessionStorage.getItem('portfolioApplicationAccess')).token).toBe(proof().token)
  render(); await openDetail()
  expect(form()).toBeDefined()
  expect(text(tree)).not.toContain('이메일로 본인 확인')
  expect(count('POST', '/application-access/exchange')).toBe(0)
})

it.each([200, 403])('suppresses a late detail response with status %s after unmount', async status => {
  await mount()
  const old = deferred()
  respond('GET', '/application-self-service/app', old.promise)
  const open = button('제출 내용 보기').props.onClick
  open(); open(); render()
  expect(count('GET', '/application-self-service/app')).toBe(1)
  unmount()
  const writes = host.writes
  old.resolve(status === 200 ? Response.json({ application: application() }) : httpError(status, 'Old permission rejection'))
  await flush()
  expect(host.writes).toBe(writes)
  expect(service.hasApplicationAccess()).toBe(true)
  open(); await flush()
  expect(count('GET', '/application-self-service/app')).toBe(1)
})

it('keeps the newest initial list when StrictMode replays the effect and the first read resolves last', async () => {
  const old = deferred()
  respond('GET', '/application-self-service', old.promise)
  respond('GET', '/application-self-service', Response.json({ applications: [{ ...summary, postingTitle: 'Newest role' }] }))
  render()
  const effects = host.cells.filter(cell => cell?.effect)
  for (const cell of effects) cell.cleanup?.()
  for (const cell of effects) cell.cleanup = cell.effect()
  await settle()
  expect(text(tree)).toContain('Newest role')
  const writes = host.writes
  old.resolve(Response.json({ applications: [{ ...summary, postingTitle: 'Old role' }] })); await flush()
  expect(host.writes).toBe(writes)
  render()
  expect(text(tree)).toContain('Newest role')
  expect(text(tree)).not.toContain('Old role')
})

it('ends access for an actual current 401 and clears the sensitive detail and draft', async () => {
  await mount(); await openDetail(); editDraft()
  respond('PATCH', '/application-self-service/app', httpError(401, 'Synthetic proof expired'))
  form().props.onSubmit({ preventDefault() {} }); await settle()
  expect(service.hasApplicationAccess()).toBe(false)
  expect(sessionStorage.getItem('portfolioApplicationAccess')).toBeNull()
  expect(text(tree)).toContain('Synthetic proof expired')
  expect(text(tree)).toContain('이메일로 본인 확인')
  expect(text(tree)).not.toContain('Draft to preserve')
  expect(field(node => node.type === 'test-guard').props.when).toBe(false)
  expect(count('GET', '/application-self-service/app')).toBe(1)
})

it('distinguishes a current stale-auth 401 from actual proof expiry', async () => {
  await mount()
  const pending = deferred()
  respond('GET', '/application-self-service/app', pending.promise)
  button('제출 내용 보기').props.onClick(); render()
  // Keep this isolated consumer mounted to exercise its stale-auth branch.
  // The real app normally remounts the route after this account change.
  await login()
  pending.resolve(Response.json({ application: application() })); await settle()
  expect(service.hasApplicationAccess()).toBe(true)
  expect(sessionStorage.getItem('portfolioApplicationAccess')).not.toBeNull()
  expect(text(tree)).toContain('본인 확인 상태가 변경되었습니다')
  expect(text(tree)).not.toContain('이메일로 본인 확인')
  await openDetail()
  expect(form()).toBeDefined()
})

it.each([403, 409])('keeps the current %s rejection and draft in explicit mutation recovery', async status => {
  await mount(); await openDetail(); editDraft()
  respond('PATCH', '/application-self-service/app', httpError(status, 'Current mutation rejection'))
  respond('GET', '/application-self-service/app', Response.json({ application: application({ revision: 1, status: 'passed', canEdit: false, canWithdraw: false }) }))
  const submit = form().props.onSubmit
  submit({ preventDefault() {} }); await settle()
  expect(service.hasApplicationAccess()).toBe(true)
  expect(text(tree)).toContain('Current mutation rejection')
  expect(field(node => node.type === 'textarea').props.value).toBe('Draft to preserve')
  expect(button('최신 제출 내용으로 다시 열기')).toBeDefined()
  expect(field(node => node.type === 'fieldset').props.disabled).toBe(true)
  expect(count('GET', '/application-self-service/app')).toBe(2)
  form().props.onSubmit({ preventDefault() {} }); await settle()
  expect(count('PATCH', '/application-self-service/app')).toBe(1)
  expect(requests.find(request => request.method === 'PATCH').options.body.get('resume').name).toBe('replacement.pdf')
})

it('keeps a successful save distinct from a current follow-up list failure', async () => {
  await mount(); await openDetail(); editDraft()
  respond('PATCH', '/application-self-service/app', Response.json({ application: application({ revision: 1, coverLetter: 'Draft to preserve' }) }))
  respond('GET', '/application-self-service', httpError(503, 'Synthetic list unavailable'))
  form().props.onSubmit({ preventDefault() {} }); await settle()
  expect(text(tree)).toContain('지원서 수정 내용을 저장했습니다')
  expect(text(tree)).toContain('변경 내용은 저장됐지만 지원 목록을 갱신하지 못했습니다')
  expect(button('최신 제출 내용으로 다시 열기')).toBeUndefined()
  expect(field(node => node.type === 'textarea').props.value).toBe('Draft to preserve')
  expect(field(node => node.type === 'test-guard').props.when).toBe(false)
  expect(service.hasApplicationAccess()).toBe(true)
})

it('clears the sensitive draft when a current stale-auth result reflects a locally expired proof', async () => {
  await mount(); await openDetail(); editDraft()
  const pending = deferred()
  respond('PATCH', '/application-self-service/app', pending.promise)
  form().props.onSubmit({ preventDefault() {} }); render()
  vi.setSystemTime(Date.now() + 61_000)
  pending.resolve(Response.json({ application: application({ revision: 1 }) })); await settle()
  expect(service.hasApplicationAccess()).toBe(false)
  expect(sessionStorage.getItem('portfolioApplicationAccess')).toBeNull()
  expect(text(tree)).toContain('이메일로 본인 확인')
  expect(text(tree)).not.toContain('Draft to preserve')
  expect(field(node => node.type === 'test-guard').props.when).toBe(false)
})

it.each([200, 401, 503])('ignores an already started follow-up list response after leaving the page: %s', async status => {
  await mount(); await openDetail(); editDraft()
  const pending = deferred()
  respond('PATCH', '/application-self-service/app', Response.json({ application: application({ revision: 1 }) }))
  respond('GET', '/application-self-service', pending.promise)
  form().props.onSubmit({ preventDefault() {} }); await flush(); render()
  expect(count('GET', '/application-self-service')).toBe(2)
  unmount()
  const writes = host.writes
  pending.resolve(status === 200 ? Response.json({ applications: [summary] }) : httpError(status, 'Old list failure'))
  await flush()
  expect(host.writes).toBe(writes)
  expect(service.hasApplicationAccess()).toBe(true)
})

it.each([200, 503])('does not apply a save response or start recovery/list GET after unmount: %s', async status => {
  await mount(); await openDetail(); editDraft()
  const pending = deferred()
  respond('PATCH', '/application-self-service/app', pending.promise)
  form().props.onSubmit({ preventDefault() {} }); render()
  expect(field(node => node.type === 'test-guard').props.when).toBe(true)
  unmount() // Models the applicant accepting the existing navigation warning.
  const writes = host.writes
  pending.resolve(status === 200 ? Response.json({ application: application({ revision: 1 }) }) : httpError(status, 'Old unknown save outcome'))
  await flush()
  expect(host.writes).toBe(writes)
  expect(count('GET', '/application-self-service/app')).toBe(1)
  expect(count('GET', '/application-self-service')).toBe(1)
  expect(service.hasApplicationAccess()).toBe(true)
})

it('does not read detail or refresh the list after a late withdrawal completion', async () => {
  await mount(); await openDetail()
  const pending = deferred()
  respond('POST', '/application-self-service/app/withdraw', pending.promise)
  button('지원 철회').props.onClick(); render(); unmount()
  const writes = host.writes
  pending.resolve(Response.json({ ok: true, status: 'withdrawn' })); await flush()
  expect(host.writes).toBe(writes)
  expect(count('GET', '/application-self-service/app')).toBe(1)
  expect(count('GET', '/application-self-service')).toBe(1)
})

it('does not start a file download when its response arrives after leaving the page', async () => {
  await mount(); await openDetail()
  const pending = deferred()
  respond('GET', '/application-self-service/app/doc/doc', pending.promise)
  button('resume.pdf 다운로드').props.onClick(); render(); unmount()
  const writes = host.writes
  pending.resolve(new Response('Synthetic file bytes')); await flush()
  expect(host.writes).toBe(writes)
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  expect(document.createElement).not.toHaveBeenCalled()
})
