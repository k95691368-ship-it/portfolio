import { genId } from './db.js'
import { hashPassword, verifyPassword, createSessionCredentials, sessionCookieHeader, normalizeEmail } from './auth.js'
import { isAccountEmail, isPasswordInput, validateAccountProfile } from './accountInput.js'
import { jsonResponse, jsonError } from './http.js'
import { checkRateLimit } from './rateLimit.js'
import { isGmailConfigured } from './gmail.js'
import { sendTrackedEmail } from './emailOutbox.js'
import { buildBrandedEmailHtml } from './emailTemplate.js'

const ORIGIN = 'https://portfolio-epa.pages.dev'
const INVALID_LINK = '인증 링크가 만료되었거나 이미 사용되었습니다. 새 링크를 요청해주세요.'

export async function recoveryTokenHash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function genericResponse(extra = {}) {
  return jsonResponse({ ok: true, message: '입력한 정보로 진행할 수 있으면 이메일을 보냅니다. 메일이 없으면 주소와 스팸함을 확인한 뒤 다시 요청해주세요.', ...extra }, 202)
}
const readBody = (context) => context.request.json().catch(() => null)

async function limit(context, action, email = '') {
  const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown'
  const identity = await recoveryTokenHash(normalizeEmail(email))
  return !!await checkRateLimit(context.env, `account:${action}:ip:${ip}`, 20, 3600) &&
    !!await checkRateLimit(context.env, `account:${action}:email:${identity}`, 5, 3600)
}
const allowedUser = (user) => user && !user.is_suspended && !user.email.endsWith('@trial.invalid')

async function matchesPassword(user, password) {
  // Do comparable password work even when the account does not exist.
  return verifyPassword(password, user?.password_hash || 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    user?.password_salt || 'AAAAAAAAAAAAAAAAAAAAAA==')
}

async function issue(context, user, purpose, persistent = false) {
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const tokenHash = await recoveryTokenHash(token)
  const minutes = purpose === 'verify_email' ? 60 : 30
  await context.env.DB.prepare(`INSERT INTO account_recovery_tokens
    (token_hash, user_id, purpose, email, password_snapshot, persistent, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(tokenHash, user.id, purpose, user.email, user.password_hash, persistent ? 1 : 0,
      new Date(Date.now() + minutes * 60000).toISOString()).run()
  const verifying = purpose === 'verify_email'
  const url = `${ORIGIN}/${verifying ? 'verify-email' : 'reset-password'}#token=${token}`
  const title = verifying ? '가입 이메일 확인' : '비밀번호 재설정'
  const explanation = verifying
    ? '아래 링크를 열고 가입할 때 입력한 비밀번호로 이메일을 확인해주세요. 요청한 적이 없다면 이 메일을 무시해주세요.'
    : '아래 링크에서 새 비밀번호를 설정해주세요. 변경하면 기존 로그인은 모두 종료됩니다. 요청한 적이 없다면 이 메일을 무시해주세요.'
  const text = `${explanation}\n\n${url}\n\n이 링크는 ${minutes}분 동안 한 번만 사용할 수 있습니다.`
  // Only the fixed origin/path and generated base64url token form a link.
  const html = buildBrandedEmailHtml({ title, bodyText: text, companyName: '통합 채용 플랫폼' })
    .replace(url, `<a href="${url}" style="color:#0067b8;">${title}</a>`)
  const deliver = sendTrackedEmail(context.env, {
    to: user.email, fromName: '통합 채용 플랫폼', subject: `[채용 플랫폼] ${title}`,
    text, html, idempotencyKey: `account:${tokenHash}`,
  }).catch(() => {
    // The outbox records delivery status. Never log the message or its token.
  })
  if (context.waitUntil) context.waitUntil(deliver)
  else await deliver
}
const unavailable = (context) => !isGmailConfigured(context.env)
  ? jsonError('이메일 발송을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.', 503) : null

export async function signupAccount(context) {
  const body = await readBody(context)
  const error = validateAccountProfile(body)
  if (error) return jsonError(error, 400)
  if (!isPasswordInput(body.password, 8)) return jsonError('비밀번호는 8~1024자여야 합니다.', 400)
  const blocked = unavailable(context)
  if (blocked) return blocked
  const email = normalizeEmail(body.email)
  if (!await limit(context, 'signup', email) || email.endsWith('@trial.invalid')) return genericResponse({ verificationRequired: true, email })
  let user = await context.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first()
  if (user) {
    const matches = await matchesPassword(user, body.password)
    if (allowedUser(user) && user.account_status === 'pending' && matches) await issue(context, user, 'verify_email', body.remember !== false)
    return genericResponse({ verificationRequired: true, email })
  }
  const { hash, salt } = await hashPassword(body.password)
  const id = genId()
  try {
    await context.env.DB.prepare(`INSERT INTO users
      (id,email,password_hash,password_salt,role,display_name,company_name,account_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`)
      .bind(id, email, hash, salt, body.role, body.displayName.trim(), body.companyName?.trim() || null).run()
  } catch (failure) {
    if (String(failure?.message).includes('UNIQUE')) return genericResponse({ verificationRequired: true, email })
    throw failure
  }
  user = await context.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()
  await issue(context, user, 'verify_email', body.remember !== false)
  return genericResponse({ verificationRequired: true, email })
}

export async function resendVerification(context) {
  const body = await readBody(context)
  if (!isAccountEmail(body?.email) || !isPasswordInput(body?.password)) return jsonError('이메일과 가입한 비밀번호를 입력해주세요.', 400)
  const blocked = unavailable(context)
  if (blocked) return blocked
  const email = normalizeEmail(body.email)
  if (!await limit(context, 'verify-request', email)) return genericResponse()
  const user = await context.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first()
  const matches = await matchesPassword(user, body.password)
  if (allowedUser(user) && !user.email_verified_at && matches) await issue(context, user, 'verify_email', body.remember === true)
  return genericResponse()
}

export async function correctPendingEmail(context) {
  const body = await readBody(context)
  if (!isAccountEmail(body?.email) || !isAccountEmail(body?.newEmail) || !isPasswordInput(body?.password)) {
    return jsonError('기존 이메일, 가입한 비밀번호, 새 이메일을 입력해주세요.', 400)
  }
  const blocked = unavailable(context)
  if (blocked) return blocked
  const email = normalizeEmail(body.email)
  const newEmail = normalizeEmail(body.newEmail)
  if (!await limit(context, 'correct-email', email) || newEmail.endsWith('@trial.invalid')) return genericResponse()
  const user = await context.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first()
  const matches = await matchesPassword(user, body.password)
  if (!allowedUser(user) || user.account_status !== 'pending' || user.email_verified_at || !matches) return genericResponse()
  try {
    const result = await context.env.DB.batch([
      context.env.DB.prepare(`UPDATE users SET email = ?
        WHERE id = ? AND email = ? AND password_hash = ? AND account_status = 'pending' AND email_verified_at IS NULL`)
        .bind(newEmail, user.id, email, user.password_hash),
      context.env.DB.prepare(`UPDATE account_recovery_tokens SET consumed_at = datetime('now')
        WHERE user_id = ? AND consumed_at IS NULL AND EXISTS (SELECT 1 FROM users
          WHERE id = ? AND email = ? AND password_hash = ? AND account_status = 'pending' AND email_verified_at IS NULL)`)
        .bind(user.id, user.id, newEmail, user.password_hash),
    ])
    if (result[0]?.meta?.changes) await issue(context, { ...user, email: newEmail }, 'verify_email', body.remember === true)
  } catch (failure) {
    if (!String(failure?.message).includes('UNIQUE')) throw failure
  }
  return genericResponse()
}

export async function forgotPassword(context) {
  const body = await readBody(context)
  if (!isAccountEmail(body?.email)) return jsonError('올바른 이메일 주소를 입력해주세요.', 400)
  const blocked = unavailable(context)
  if (blocked) return blocked
  const email = normalizeEmail(body.email)
  if (!await limit(context, 'forgot', email)) return genericResponse()
  const user = await context.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first()
  if (allowedUser(user)) await issue(context, user, 'reset_password')
  return genericResponse()
}

async function loadToken(context, body, purpose) {
  if (typeof body?.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) return null
  const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown'
  if (!await checkRateLimit(context.env, `account:redeem:${ip}`, 30, 3600)) return null
  const tokenHash = await recoveryTokenHash(body.token)
  return context.env.DB.prepare(`SELECT t.*, u.password_salt FROM account_recovery_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.purpose = ? AND t.consumed_at IS NULL
      AND datetime(t.expires_at) > datetime('now') AND u.is_suspended = 0
      AND u.email = t.email AND u.password_hash = t.password_snapshot`)
    .bind(tokenHash, purpose).first()
}

function claim(db, token, claimId) {
  return db.prepare(`UPDATE account_recovery_tokens SET consumed_at = datetime('now'), consumed_by = ?
    WHERE token_hash = ? AND consumed_at IS NULL AND datetime(expires_at) > datetime('now')
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = account_recovery_tokens.user_id
        AND u.email = account_recovery_tokens.email AND u.password_hash = account_recovery_tokens.password_snapshot
        AND u.is_suspended = 0)`)
    .bind(claimId, token.token_hash)
}
const claimExists = 'EXISTS (SELECT 1 FROM account_recovery_tokens WHERE token_hash = ? AND consumed_by = ?)'

export async function verifyAccountEmail(context) {
  const body = await readBody(context)
  if (!isPasswordInput(body?.password)) return jsonError('가입한 비밀번호를 입력해주세요.', 400)
  const token = await loadToken(context, body, 'verify_email')
  if (!token || !await verifyPassword(body.password, token.password_snapshot, token.password_salt)) return jsonError(INVALID_LINK, 400)
  const claimId = genId()
  const db = context.env.DB
  const persistent = token.persistent === 1
  const session = await createSessionCredentials({ persistent })
  const result = await db.batch([
    // Serialize all proofs for one account, including distinct tokens. Without
    // this lock two different reset links could both pass the old-password check.
    db.prepare('UPDATE users SET account_status = account_status WHERE id = ?').bind(token.user_id),
    claim(db, token, claimId),
    db.prepare(`UPDATE users SET email_verified_at = datetime('now'), account_status = 'active'
      WHERE id = ? AND ${claimExists}`).bind(token.user_id, token.token_hash, claimId),
    db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at, auth_method, scoped_room_id)
      SELECT ?, ?, ?, 'password', NULL WHERE ${claimExists}`)
      .bind(session.tokenHash, token.user_id, session.expiresAt, token.token_hash, claimId),
  ])
  if (!result[1]?.meta?.changes || !result[2]?.meta?.changes) return jsonError(INVALID_LINK, 400)
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(token.user_id).first()
  const { token: sessionToken, expiresAt } = session
  return jsonResponse({ id: user.id, email: user.email, role: user.role, displayName: user.display_name,
    isAdmin: !!user.is_admin, isRecruiter: !!user.is_recruiter, isDeveloper: !!user.is_developer,
    mustChangePassword: !!user.must_change_password, emailVerified: true,
    sessionToken, sessionExpiresAt: expiresAt, sessionPersistent: persistent,
  }, 200, { 'Set-Cookie': sessionCookieHeader(sessionToken, { persistent }) })
}

export async function resetAccountPassword(context) {
  const body = await readBody(context)
  if (!isPasswordInput(body?.newPassword, 8)) return jsonError('새 비밀번호는 8~1024자여야 합니다.', 400)
  const token = await loadToken(context, body, 'reset_password')
  if (!token) return jsonError(INVALID_LINK, 400)
  const { hash, salt } = await hashPassword(body.newPassword)
  const claimId = genId()
  const db = context.env.DB
  const results = await db.batch([
    db.prepare('UPDATE users SET account_status = account_status WHERE id = ?').bind(token.user_id),
    claim(db, token, claimId),
    db.prepare(`UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0,
      email_verified_at = datetime('now'), account_status = 'active' WHERE id = ? AND ${claimExists}`)
      .bind(hash, salt, token.user_id, token.token_hash, claimId),
    db.prepare(`DELETE FROM sessions WHERE user_id = ? AND ${claimExists}`).bind(token.user_id, token.token_hash, claimId),
  ])
  if (!results[1]?.meta?.changes || !results[2]?.meta?.changes) return jsonError(INVALID_LINK, 400)
  return jsonResponse({ ok: true })
}
