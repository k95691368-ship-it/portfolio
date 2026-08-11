const PBKDF2_ITERATIONS = 100000
// 로그인 유지를 고른 경우와 아닌 경우.
//
// 지금까지는 30일 하나뿐이었다. 즉 이 서비스는 로그인 유지를 끌 방법이 없었고,
// PC방이나 학교 컴퓨터에서 지원한 사람이 창을 닫아도 세션이 그대로 살아
// 있었다. 그 계정 안에는 서명한 근로계약서와 연락처가 들어 있다.
//
// 유지를 고르지 않으면 브라우저를 닫는 순간 쿠키가 사라지고, 서버 쪽 토큰도
// 하루 안에 죽는다. 쿠키만 지우면 훔쳐 간 토큰은 그대로 살아 있으므로 둘 다
// 짧게 잡는다.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30일
const SHORT_SESSION_TTL_SECONDS = 60 * 60 * 12 // 12시간 — 하루 일과

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0))
}

function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function pbkdf2(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  return new Uint8Array(derivedBits)
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// 계정 이메일을 저장·조회 전에 한 가지 표기로 통일한다.
//
// users.email의 UNIQUE는 대소문자를 구분하는데 지원서 쪽(apply.js)은 항상
// 소문자로 저장한다. 그래서 이메일에 대문자가 한 글자만 있어도 같은 사람이
// 두 계정으로 갈라졌다 — 지원자는 자기 면접방에 403으로 막히고, 반대로
// 대소문자만 바꿔 가입하면 남의 지원 내역이 "내 지원 현황"에 보였다.
// 이메일은 도메인이 대소문자를 구분하지 않고, 실무에서 로컬파트도 구분하지
// 않으므로 소문자로 통일한다.
export function normalizeEmail(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hashBytes = await pbkdf2(password, salt)
  return { hash: toBase64(hashBytes), salt: toBase64(salt) }
}

export async function verifyPassword(password, storedHash, storedSalt) {
  const hashBytes = await pbkdf2(password, fromBase64(storedSalt))
  return timingSafeEqual(toBase64(hashBytes), storedHash)
}

export async function createSession(db, userId, options = {}) {
  // 명시하지 않으면 유지한다 — 예전 동작 그대로.
  const persistent = options.persistent !== false
  const ttl = persistent ? SESSION_TTL_SECONDS : SHORT_SESSION_TTL_SECONDS
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString()

  // 만료된 세션 행은 아무도 지우지 않아 영원히 쌓이고 있었다. 새 세션을 만들
  // 때 이 사용자의 죽은 행을 함께 치운다 — 따로 도는 청소 작업이 없는 환경이라,
  // 치울 기회는 여기뿐이다.
  await db
    .prepare("DELETE FROM sessions WHERE user_id = ? AND datetime(expires_at) <= datetime('now')")
    .bind(userId)
    .run()
    .catch(() => {})
  await db
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(tokenHash, userId, expiresAt)
    .run()
  return { token, expiresAt }
}

export async function deleteSession(db, token) {
  const tokenHash = await sha256Hex(token)
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
}

export async function deleteAllUserSessions(db, userId) {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run()
}

export function parseCookie(request, name) {
  const header = request.headers.get('Cookie') || ''
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

// Max-Age 를 붙이지 않으면 브라우저를 닫을 때 쿠키가 사라진다(세션 쿠키).
export function sessionCookieHeader(token, options = {}) {
  const base = `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/`
  if (options.persistent === false) return base
  return `${base}; Max-Age=${SESSION_TTL_SECONDS}`
}

export function clearSessionCookieHeader() {
  return 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
}

export async function getSessionUser(db, request) {
  const token = parseCookie(request, 'session')
  if (!token) return null
  const tokenHash = await sha256Hex(token)
  const row = await db
    .prepare(
      // 서명이 어느 로그인 세션에서 이루어졌는지 남기기 위해 세션 시작 시각을
      // 함께 읽는다. 서명 증거는 "누가 언제 어디서"인데, 지금까지 "언제 로그인한
      // 세션인지"가 어디에도 없었다.
      // expires_at 은 JS 의 toISOString() 이라 "2026-08-14T06:00:00.000Z" 이고
      // datetime('now') 는 "2026-08-14 06:00:00" 이다. 문자열로 비교하면 열한
      // 번째 글자에서 'T'(0x54) 와 공백(0x20) 이 만나 언제나 'T' 가 크다. 그래서
      // 만료 당일에는 몇 시간이 지났든 세션이 살아 있다. 만료를 하루 늦추는 셈이다.
      // datetime() 으로 감싸 두 형식을 같은 값으로 읽는다.
      `SELECT users.*, sessions.created_at AS session_started_at FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND datetime(sessions.expires_at) > datetime('now')`
    )
    .bind(tokenHash)
    .first()
  if (!row || row.is_suspended) return null
  return row
}

// 쓰고 있는 동안에는 로그인이 끝나지 않게 만료를 미룬다.
//
// 30일은 로그인한 순간부터 세는 값이고 한 번도 늘어나지 않았다. 매일 들어와도
// 31일째에는 로그아웃된다 — 쓰지 않아서가 아니라 그냥 시간이 지나서. "로그인
// 유지"라고 부르려면 쓰는 동안에는 유지되어야 한다.
//
// 매 요청마다 쓰지는 않는다. 남은 기간이 절반 아래로 내려갔을 때만 미루므로
// 활동하는 사람 기준 보름에 한 번이다.
//
// 브라우저를 닫으면 끝나기로 한 세션(유지를 고르지 않은 로그인)은 미루지
// 않는다. 그 구분은 따로 저장하지 않고 처음 잡았던 기간으로 안다 — 하루보다
// 길게 잡혔으면 유지를 고른 로그인이다.
const RENEW_WHEN_REMAINING_SECONDS = SESSION_TTL_SECONDS / 2

export async function renewSessionIfStale(db, request) {
  const token = parseCookie(request, 'session')
  if (!token) return
  const tokenHash = await sha256Hex(token)

  await db
    .prepare(
      `UPDATE sessions
          SET expires_at = ?1
        WHERE token_hash = ?2
          AND datetime(expires_at) > datetime('now')
          AND datetime(expires_at) < datetime('now', ?3)
          AND (julianday(expires_at) - julianday(created_at)) > 1`
    )
    .bind(
      new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
      tokenHash,
      `+${RENEW_WHEN_REMAINING_SECONDS} seconds`
    )
    .run()
    .catch(() => {})
}
