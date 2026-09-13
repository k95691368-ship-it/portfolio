// Gmail REST API only: no mailbox read scope, SMTP password, or browser secrets.
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CRLF = '\r\n'
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
const encoder = new TextEncoder()

function mailbox(value) {
  const email = String(value || '').trim()
  // One ASCII mailbox, not a display name or recipient list. Header injection
  // must be rejected before asking Google for an access token.
  if (email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email)) {
    throw new Error('이메일 주소 형식을 확인해주세요.')
  }
  return email
}

export function isGmailConfigured(env) {
  if (env.EMAIL_ENABLED !== '1') return false
  if (![env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET, env.GMAIL_REFRESH_TOKEN].every(
    (value) => typeof value === 'string' && value.trim()
  )) return false
  try {
    mailbox(env.FINAL_OFFER_FROM_EMAIL)
    return true
  } catch {
    return false
  }
}

function base64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function header(value) {
  const text = String(value || '')
  if (Array.from(text).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error('메일 제목·발신자 이름·파일명에 제어 문자를 사용할 수 없습니다.')
  }
  // RFC 2047: encoded words <= 75 characters, never split a UTF-8 character.
  const words = []
  let chunk = ''
  for (const character of text) {
    if (encoder.encode(chunk + character).length > 42) {
      words.push(`=?UTF-8?B?${base64(encoder.encode(chunk))}?=`)
      chunk = ''
    }
    chunk += character
  }
  if (chunk) words.push(`=?UTF-8?B?${base64(encoder.encode(chunk))}?=`)
  return words.join(`${CRLF} `)
}

function wrappedBase64(value) {
  return value.match(/.{1,76}/g)?.join(CRLF) || ''
}

function textPart(type, content) {
  return [
    `Content-Type: ${type}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64', '',
    wrappedBase64(base64(encoder.encode(String(content || '').replace(/\r\n|\r|\n/g, CRLF)))),
  ].join(CRLF)
}

function attachmentPart(attachment) {
  const filename = String(attachment.filename || 'attachment.pdf')
  header(filename) // Validate before interpolating encoded filename parameters.
  if (encoder.encode(filename).length > 1024) throw new Error('첨부 파일명이 너무 깁니다.')
  const type = attachment.contentType || 'application/octet-stream'
  if (!/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(type)) throw new Error('첨부 파일 형식이 올바르지 않습니다.')
  const content = attachment.contentBase64
  if (typeof content !== 'string' || content.length > 4 * Math.ceil(MAX_ATTACHMENT_BYTES / 3)) {
    throw new Error('첨부 파일은 8MB 이하의 base64 데이터여야 합니다.')
  }
  if (content.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(content) || /=/.test(content.slice(0, -2)) || /=[^=]$/.test(content)) {
    throw new Error('첨부 파일 데이터가 올바르지 않습니다.')
  }
  const byteCount = content.length / 4 * 3 - (content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0)
  if (byteCount > MAX_ATTACHMENT_BYTES) throw new Error('첨부 파일은 8MB 이하여야 합니다.')
  // RFC 2231: extended filename parameters, split only between encoded bytes.
  const bytes = encoder.encode(filename)
  const parameters = []
  for (let i = 0; i < bytes.length; i += 15) {
    const encoded = Array.from(bytes.subarray(i, i + 15), (byte) => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`).join('')
    parameters.push(` filename*${i / 15}*=${i === 0 ? "UTF-8''" : ''}${encoded}`)
  }
  return [
    `Content-Type: ${type}`,
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment;',
    parameters.join(`;${CRLF}`), '', wrappedBase64(content),
  ].join(CRLF)
}

function rawMessage({ from, fromName, to, subject, text, html, attachments = [] }) {
  if (!Array.isArray(attachments) || attachments.length > 1) throw new Error('계약서 첨부는 1개까지 가능합니다.')
  const alternative = `alternative_${crypto.randomUUID()}`
  const mixed = `mixed_${crypto.randomUUID()}`
  const name = header(fromName)
  const headers = [
    `From: ${name ? `${name}${CRLF} ` : ''}<${mailbox(from)}>`,
    `To: <${mailbox(to)}>`,
    `Subject: ${header(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${mailbox(from).split('@')[1]}>`,
    'MIME-Version: 1.0',
  ]
  const body = [
    `Content-Type: multipart/alternative; boundary="${alternative}"`, '',
    `--${alternative}`, textPart('text/plain', text),
    `--${alternative}`, textPart('text/html', html), `--${alternative}--`,
  ].join(CRLF)
  const message = attachments.length
    ? [...headers, `Content-Type: multipart/mixed; boundary="${mixed}"`, '',
      `--${mixed}`, body, `--${mixed}`, attachmentPart(attachments[0]), `--${mixed}--`, ''].join(CRLF)
    : [...headers, body, ''].join(CRLF)
  return base64(encoder.encode(message)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function googleRequest(url, init, stage) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'error' })
    // Do not surface provider response text: routes store errors in delivery logs.
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      if (stage === '인증' && data?.error === 'invalid_grant') {
        throw new Error('Gmail 연결 권한이 만료되거나 취소되었습니다. Google 계정을 다시 연결해주세요.')
      }
      if (response.status === 429) throw new Error('Gmail 요청 한도에 도달했습니다. 발송 기록을 확인한 뒤 다시 시도해주세요.')
      if (response.status === 401 || response.status === 403) throw new Error(`Gmail ${stage} 권한 또는 발송 한도를 확인해주세요. (${response.status})`)
      throw new Error(`Gmail ${stage} 요청에 실패했습니다. (${response.status})`)
    }
    return data
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Gmail ')) throw error
    // A network failure may occur after Gmail accepted the message. Never retry
    // messages.send automatically, and never claim that no message was sent.
    throw new Error(stage === '발송'
      ? 'Gmail 발송 결과를 확인하지 못했습니다. 보낸메일함을 확인한 뒤 재시도해주세요.'
      : 'Gmail 인증 서버에 연결하지 못했습니다.')
  } finally {
    clearTimeout(timer)
  }
}

export async function sendGmailEmail(env, message) {
  // Also gate direct callers; checking only at the route is not sufficient.
  if (!isGmailConfigured(env)) throw new Error('Gmail 발송 설정이 완료되지 않았거나 EMAIL_ENABLED가 꺼져 있습니다.')
  const from = mailbox(env.FINAL_OFFER_FROM_EMAIL)
  const raw = rawMessage({ ...message, from })
  const token = await googleRequest(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }).toString(),
  }, '인증')
  if (typeof token?.access_token !== 'string' || !/^[A-Za-z0-9._~+/-]+=*$/.test(token.access_token)) {
    throw new Error('Gmail 인증 응답이 올바르지 않습니다.')
  }
  // Explicit mailbox instead of "me": mismatched sender/token must fail, not
  // silently send from a different signed-in Google account.
  const result = await googleRequest(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(from)}/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  }, '발송')
  if (typeof result?.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(result.id)) {
    throw new Error('Gmail 발송 결과를 확인하지 못했습니다. 보낸메일함을 확인한 뒤 재시도해주세요.')
  }
  // Accepted by Gmail does not guarantee inbox delivery. Return no provider data
  // other than the message identifier needed for diagnostics.
  return { id: result.id }
}
