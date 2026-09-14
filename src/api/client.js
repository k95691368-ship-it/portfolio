import { withRequestDeadline } from './requestDeadline.js'

export const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.PROD
    ? 'https://obumqkwkvnemkyaahjbn.supabase.co/functions/v1/api'
    : '/api')

// Supabase publishable keys are intentionally safe to ship in browser bundles.
// The environment override keeps previews portable while the checked-in fallback
// lets Cloudflare Pages deploy directly from GitHub without a secret binding.
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_zmTib9W6f8wfKt-p_mBuVw_XxCe2EwR'

const SESSION_KEY = 'portfolioSession'
const ROOM_SESSION_KEY = 'portfolioRoomSessions'

function parseStored(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) || 'null')
    if (!value?.token) return null
    if (value.expiresAt && Date.parse(value.expiresAt) <= Date.now()) {
      storage.removeItem(key)
      return null
    }
    return value
  } catch {
    return null
  }
}

function accountSession() {
  return parseStored(sessionStorage, SESSION_KEY) || parseStored(localStorage, SESSION_KEY)
}

function storeAccountSession(data) {
  if (!data?.sessionToken) return
  const target = data.sessionPersistent === false ? sessionStorage : localStorage
  const other = target === localStorage ? sessionStorage : localStorage
  other.removeItem(SESSION_KEY)
  target.setItem(
    SESSION_KEY,
    JSON.stringify({ token: data.sessionToken, expiresAt: data.sessionExpiresAt || null })
  )
}

function clearAccountSession() {
  localStorage.removeItem(SESSION_KEY)
  sessionStorage.removeItem(SESSION_KEY)
}

// Update only the token used for this request: a late response must not extend
// a different account after logout/login in another tab.
function acceptRenewal(res, headers) {
  const expiresAt = res.headers.get('X-App-Session-Expires-At')
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) return
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const saved = JSON.parse(storage.getItem(SESSION_KEY) || 'null')
      if (saved?.token && headers['X-App-Authorization'] === `Bearer ${saved.token}` &&
          Date.parse(expiresAt) > Date.parse(saved.expiresAt || 0)) {
        storage.setItem(SESSION_KEY, JSON.stringify({ ...saved, expiresAt }))
      }
    } catch { /* Private browsing can deny storage writes. */ }
  }
}

function roomSessions() {
  try {
    const rows = JSON.parse(localStorage.getItem(ROOM_SESSION_KEY) || '{}')
    const current = {}
    for (const [roomId, value] of Object.entries(rows || {})) {
      if (value?.token && (!value.expiresAt || Date.parse(value.expiresAt) > Date.now())) {
        current[roomId] = value
      }
    }
    return current
  } catch {
    return {}
  }
}

function storeRoomSession(data) {
  if (!data?.roomId || !data?.roomSessionToken) return
  const rows = roomSessions()
  rows[data.roomId] = {
    token: data.roomSessionToken,
    expiresAt: data.roomSessionExpiresAt || null,
  }
  localStorage.setItem(ROOM_SESSION_KEY, JSON.stringify(rows))
}

// 어느 문으로 방에 들어왔는가.
//
// 한 컴퓨터에 회사 계정과 면접방 코드가 함께 있을 수 있다 — 담당자가 회사
// 계정으로 일하다가 구직자 홈에서 코드를 넣어 보는 경우다. 쿠키는 둘 다
// 브라우저에 남으므로, 서버는 어느 쪽으로 들어온 사람인지 스스로 알 수 없다.
//
// 그래서 마지막으로 연 문을 여기서 기억해 두고 방 요청에 붙여 보낸다.
//   구직자 홈에서 코드로 들어가면 -> 그 방은 지원자로
//   채용자 홈에서 방을 열면      -> 그 방은 회사 계정으로
// 새로고침하고 브라우저를 닫았다 열어도 유지되어야 하므로 localStorage 에 둔다.
// 신원 자체가 아니라 '어느 문'인지만 담는다 — 여기 값을 바꿔도 서버가 주는
// 권한은 달라지지 않는다. 쿠키가 없으면 아무것도 열리지 않는다.
const DOOR_KEY = 'roomDoor'

function readDoor() {
  try {
    const raw = localStorage.getItem(DOOR_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function markRoomDoor(roomId, door) {
  try {
    if (!roomId) return
    localStorage.setItem(DOOR_KEY, JSON.stringify({ roomId, door }))
  } catch {
    /* 저장이 막힌 브라우저에서도 방은 열려야 한다 */
  }
}

export function roomDoorFor(roomId) {
  const saved = readDoor()
  return saved && saved.roomId === roomId ? saved.door : null
}

// 이 요청이 어느 문으로 들어간 그 방에 대한 것인가.
function roomIdentityHeader(path) {
  const match = path.match(/^\/rooms\/([^/]+)\/.+/)
  if (!match) return null
  const door = roomDoorFor(decodeURIComponent(match[1]))
  return door === 'code' || door === 'account'
    ? { 'X-Room-Identity': door }
    : null
}

function authHeaders(path) {
  const headers = {
    'X-App-Request': '1',
    apikey: SUPABASE_PUBLISHABLE_KEY,
  }
  const account = accountSession()
  if (account?.token) headers['X-App-Authorization'] = `Bearer ${account.token}`

  const match = path.match(/^\/rooms\/([^/]+)\/.+/)
  if (match) {
    const roomId = decodeURIComponent(match[1])
    const room = roomSessions()[roomId]
    if (room?.token) headers['X-Room-Authorization'] = `Bearer ${room.token}`
  }
  return headers
}

const ACCOUNT_AUTH_PATHS = new Set(['/login', '/signup', '/demo/login', '/change-password', '/logout'])
let authGeneration = 0

function identitySnapshot(path) {
  const headers = authHeaders(path)
  return JSON.stringify([
    authGeneration,
    headers['X-App-Authorization'] || null,
    headers['X-Room-Authorization'] || null,
    roomIdentityHeader(path)?.['X-Room-Identity'] || null,
  ])
}

function assertCurrentIdentity(path, snapshot, response) {
  if (identitySnapshot(path) === snapshot) return
  // Do not download another account's file if identity changed before headers arrived.
  if (response?.body) void response.body.cancel().catch(() => {})
  const error = new Error('로그인 또는 면접방 입장 상태가 변경되었습니다. 현재 계정에서 다시 확인해주세요.')
  error.code = 'STALE_AUTH_RESPONSE'
  error.status = 409
  throw error
}

function acceptAuthResponse(path, data) {
  if (ACCOUNT_AUTH_PATHS.has(path)) storeAccountSession(data)
  if (path === '/rooms/enter') storeRoomSession(data)
  if (path === '/logout') clearAccountSession()
}

// 서버 응답을 사용자에게 보여줄 오류로 변환한다.
// 권한 거부(403)는 항상 "권한 없음"으로 시작하게 맞춰, 어떤 화면에서 막히든
// 같은 문구로 인지되도록 한다. 상태 코드 자체는 절대 노출하지 않는다.
function toUserError(res, data) {
  let message = data?.error || '요청에 실패했습니다.'
  if (res.status === 403 && !message.startsWith('권한 없음')) {
    message = `권한 없음 — ${message}`
  }
  const error = new Error(message)
  error.status = res.status
  // 서버가 함께 보낸 내용을 버리고 있었다. 그래서 화면은 같은 409 를 모두
  // 같은 뜻으로 읽을 수밖에 없었고, "확인이 필요하다"와 "이미 처리되었다"가
  // 구별되지 않아 사실이 아닌 경고창이 떴다.
  error.data = data ?? null
  return error
}

const pendingReads = new Map()
let writeGeneration = 0

async function performRequest(path, options, headers, timeoutMs = 120_000) {
  const snapshot = identitySnapshot(path)
  return withRequestDeadline(async (signal) => {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal,
      credentials: 'omit',
      headers,
    })
    if (signal.aborted) throw signal.reason
    assertCurrentIdentity(path, snapshot, res)
    const data = await res.json().catch(() => null)
    if (signal.aborted) throw signal.reason
    assertCurrentIdentity(path, snapshot, res)
    acceptRenewal(res, headers)
    if (!res.ok) throw toUserError(res, data)
    acceptAuthResponse(path, data)
    return data
  }, { signal: options.signal, timeoutMs })
}

function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...authHeaders(path),
    ...roomIdentityHeader(path),
    ...(options.headers || {}),
  }
  if ((options.method || 'GET') !== 'GET') {
    if (ACCOUNT_AUTH_PATHS.has(path) || path === '/rooms/enter') authGeneration += 1
    writeGeneration += 1
    return performRequest(path, options, headers).finally(() => { writeGeneration += 1 })
  }
  // 진행 중인 동일 조회만 공유한다. 인증·방 신원·쓰기 전후를 구별하며
  // 완료 응답은 저장하지 않아 다음 조회가 오래된 내용을 받지 않는다.
  const key = JSON.stringify([writeGeneration, authGeneration, path, headers])
  if (pendingReads.has(key)) return pendingReads.get(key)
  const pending = performRequest(path, options, headers).finally(() => {
    if (pendingReads.get(key) === pending) pendingReads.delete(key)
  })
  pendingReads.set(key, pending)
  return pending
}

async function upload(path, formData) {
  writeGeneration += 1
  const headers = { ...authHeaders(path), ...roomIdentityHeader(path) }
  return performRequest(path, { method: 'POST', body: formData }, headers, 300_000)
    .finally(() => { writeGeneration += 1 })
}

export async function apiBlob(path) {
  const headers = { ...authHeaders(path), ...roomIdentityHeader(path) }
  const snapshot = identitySnapshot(path)
  return withRequestDeadline(async (signal) => {
    const res = await fetch(`${API_BASE}${path}`, {
      signal,
      credentials: 'omit',
      headers,
    })
    if (signal.aborted) throw signal.reason
    assertCurrentIdentity(path, snapshot, res)
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      if (signal.aborted) throw signal.reason
      assertCurrentIdentity(path, snapshot, res)
      throw toUserError(res, data)
    }
    const blob = await res.blob()
    if (signal.aborted) throw signal.reason
    assertCurrentIdentity(path, snapshot, res)
    acceptRenewal(res, headers)
    return {
      blob,
      filename: decodeURIComponent(
        res.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ||
          'download'
      ),
    }
  }, { timeoutMs: 300_000 })
}

export async function downloadApiFile(path) {
  const { blob, filename } = await apiBlob(path)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const api = {
  get: (path) => request(path),
  post: (path, body, options = {}) => request(path, { ...options, method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  // DELETE에도 본문을 실을 수 있어야 한다 — 보존 의무처럼 "알고도 지운다"는
  // 확인을 서버가 받아야 하는 경우가 있다.
  delete: (path, body) =>
    request(path, { method: 'DELETE', ...(body ? { body: JSON.stringify(body) } : {}) }),
  upload,
}
