const PBKDF2_ITERATIONS = 100000
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30일

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

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hashBytes = await pbkdf2(password, salt)
  return { hash: toBase64(hashBytes), salt: toBase64(salt) }
}

export async function verifyPassword(password, storedHash, storedSalt) {
  const hashBytes = await pbkdf2(password, fromBase64(storedSalt))
  return timingSafeEqual(toBase64(hashBytes), storedHash)
}

export async function createSession(db, userId) {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  const tokenHash = await sha256Hex(token)
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString()
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

export function sessionCookieHeader(token) {
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`
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
      `SELECT users.* FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now')`
    )
    .bind(tokenHash)
    .first()
  if (!row || row.is_suspended) return null
  return row
}
