import { API_BASE, getAccountAuthRevision } from '../api/client.js'
import { withRequestDeadline } from '../api/requestDeadline.js'

const KEY = 'portfolioApplicationAccess'
let accessRevision = 0
let accessEnded = false
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_zmTib9W6f8wfKt-p_mBuVw_XxCe2EwR'

export function newApplicationOperation() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('')
}

export function applicationOperation(postingId) {
  const key = `portfolioApplicationOperation:${postingId}`
  const saved = sessionStorage.getItem(key)
  if (/^[a-f0-9]{64}$/.test(saved || '')) return saved
  const token = newApplicationOperation()
  sessionStorage.setItem(key, token)
  return token
}

// Only an explicit new application replaces a recovered operation.
export function restartApplicationOperation(postingId) {
  const token = newApplicationOperation()
  sessionStorage.setItem(`portfolioApplicationOperation:${postingId}`, token)
  return token
}

export function clearApplicationAccess() {
  accessRevision += 1
  accessEnded = true
  try { sessionStorage.removeItem(KEY) } catch { /* Memory gate still ends access in this page. */ }
}

export function hasApplicationAccess() {
  if (accessEnded) return false
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    return /^[a-f0-9]{64}$/.test(saved?.token || '') && Date.parse(saved.expiresAt) > Date.now()
  } catch { return false }
}

async function call(path, { method = 'GET', body, scoped = true, file = false } = {}) {
  const accountRevision = getAccountAuthRevision()
  const revision = accessRevision
  let token
  const assertCurrent = () => {
    if (accountRevision !== getAccountAuthRevision() || revision !== accessRevision ||
      (scoped && (!hasApplicationAccess() || JSON.parse(sessionStorage.getItem(KEY)).token !== token))) {
      throw Object.assign(new Error('본인 확인 상태가 변경되었습니다. 이메일 확인을 다시 진행해주세요.'), { code: 'STALE_AUTH_RESPONSE', status: 401 })
    }
  }
  const headers = { apikey: PUBLISHABLE_KEY, 'X-App-Request': '1' }
  if (scoped) {
    if (!hasApplicationAccess()) throw Object.assign(new Error('이메일의 확인 링크를 다시 열어주세요.'), { status: 401 })
    token = JSON.parse(sessionStorage.getItem(KEY)).token
    headers['X-Application-Authorization'] = `Bearer ${token}`
  }
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
  return withRequestDeadline(async signal => {
    let response
    try {
      response = await fetch(`${API_BASE}${path}`, { method, headers, credentials: 'omit', signal,
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined })
    } catch (error) { assertCurrent(); throw error }
    assertCurrent()
    if (file && response.ok) {
      const blob = await response.blob()
      assertCurrent()
      return blob
    }
    const data = await response.json().catch(() => null)
    assertCurrent()
    if (!response.ok) throw Object.assign(new Error(data?.error || '요청을 처리하지 못했습니다.'), { status: response.status })
    return data
  }, { timeoutMs: 120_000 })
}

export const applicationAccess = {
  request: email => call('/application-access/request', { method: 'POST', body: { email }, scoped: false }),
  async exchange(token) {
    const accountRevision = getAccountAuthRevision()
    const revision = ++accessRevision
    const result = await call('/application-access/exchange', { method: 'POST', body: { token }, scoped: false })
    if (accountRevision !== getAccountAuthRevision() || revision !== accessRevision) {
      throw Object.assign(new Error('본인 확인이 종료되었습니다. 새 확인 링크를 요청해주세요.'), { code: 'STALE_AUTH_RESPONSE', status: 401 })
    }
    try { sessionStorage.setItem(KEY, JSON.stringify(result)) }
    catch { throw new Error('확인 정보를 저장하지 못했습니다. 브라우저 저장소 설정을 확인한 뒤 새 링크를 요청해주세요.') }
    accessEnded = false
    return result
  },
  list: () => call('/application-self-service'),
  get: id => call(`/application-self-service/${encodeURIComponent(id)}`),
  save: (id, body) => call(`/application-self-service/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  withdraw: (id, revision) => call(`/application-self-service/${encodeURIComponent(id)}/withdraw`, { method: 'POST', body: { revision } }),
  file: (id, docId) => call(`/application-self-service/${encodeURIComponent(id)}/doc/${encodeURIComponent(docId)}`, { file: true }),
}
