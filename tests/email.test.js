import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  maskEmail, isEmailConfigured, sendFinalOfferEmail, sendRoomInviteEmail,
  sendApplicationResultEmail, sendNewMessageEmail, sendSignedContractEmail,
} from '../server/_lib/email.js'

// Synthetic credentials only. Every network request is intercepted.
const env = {
  EMAIL_ENABLED: '1', GMAIL_CLIENT_ID: 'test-client', GMAIL_CLIENT_SECRET: 'test-secret',
  GMAIL_REFRESH_TOKEN: 'test-refresh', FINAL_OFFER_FROM_EMAIL: 'sender@gmail.com',
  FINAL_OFFER_FROM_NAME: '채용팀',
}
const message = { to: 'candidate@example.com', subject: '최종 합격 안내', bodyText: '합격을 축하합니다.', companyName: '회사' }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
function mockGoogle() {
  const mock = vi.fn().mockResolvedValueOnce(json({ access_token: 'test-access', expires_in: 3600 }))
    .mockResolvedValueOnce(json({ id: 'test-message', threadId: 'test-thread' }))
  vi.stubGlobal('fetch', mock)
  return mock
}
function mimeFrom(mock) {
  return Buffer.from(JSON.parse(mock.mock.calls[1][1].body).raw, 'base64url').toString('utf8')
}
function textParts(mime) {
  return [...mime.matchAll(/Content-Type: text\/(plain|html); charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]*?)\r\n--/g)]
    .map((match) => ({ type: match[1], value: Buffer.from(match[2], 'base64').toString('utf8') }))
}
function decodeWords(value) {
  return [...value.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)]
    .map((match) => Buffer.from(match[1], 'base64').toString('utf8')).join('')
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Gmail email adapter', () => {
  it('masks the candidate email address', () => {
    expect(maskEmail('candidate@example.com')).toBe('ca*******@example.com')
    expect(maskEmail('a@example.com')).toBe('a*@example.com')
    expect(maskEmail('invalid')).toBe('')
  })

  it('requires the explicit enable switch and all Gmail settings', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(isEmailConfigured(env)).toBe(true)
    for (const key of ['EMAIL_ENABLED', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'FINAL_OFFER_FROM_EMAIL']) {
      const incomplete = { ...env, [key]: '' }
      expect(isEmailConfigured(incomplete)).toBe(false)
      await expect(sendFinalOfferEmail(incomplete, message)).rejects.toThrow('Gmail 발송 설정')
    }
    expect(isEmailConfigured({ ...env, EMAIL_ENABLED: '0' })).toBe(false)
    expect(isEmailConfigured({ ...env, FINAL_OFFER_FROM_EMAIL: 'bad\r\nBcc: x@example.com' })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes OAuth server-side then sends only to the configured Gmail mailbox endpoint', async () => {
    const mock = mockGoogle()
    expect(await sendFinalOfferEmail(env, message)).toEqual({ id: 'test-message' })
    expect(mock).toHaveBeenCalledTimes(2)
    const [url, init] = mock.mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token',
    })
    expect(mock.mock.calls[1][0]).toBe('https://gmail.googleapis.com/gmail/v1/users/sender%40gmail.com/messages/send')
    expect(mock.mock.calls[1][1].headers.Authorization).toBe('Bearer test-access')
    const raw = JSON.parse(mock.mock.calls[1][1].body).raw
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
    const mime = mimeFrom(mock)
    expect(mime).toContain('<sender@gmail.com>')
    expect(mime).toContain('To: <candidate@example.com>')
    expect(decodeWords(mime.split('\r\nTo:')[0])).toBe('채용팀')
    expect(textParts(mime).find((part) => part.type === 'plain').value).toBe(message.bodyText)
    expect(mime).not.toContain(env.GMAIL_REFRESH_TOKEN)
    expect(mime).not.toContain(env.GMAIL_CLIENT_SECRET)
  })

  it('preserves Korean, emoji, line breaks and escaped HTML', async () => {
    const mock = mockGoogle()
    await sendFinalOfferEmail(env, { ...message, bodyText: '면접 📋\n<script>alert("x")</script>', companyName: 'A&B <채용팀>' })
    const parts = textParts(mimeFrom(mock))
    expect(parts).toHaveLength(2)
    expect(parts[0].value).toBe('면접 📋\r\n<script>alert("x")</script>')
    expect(parts[1].value).toContain('면접 📋<br>&lt;script&gt;')
    expect(parts[1].value).not.toContain('<script>alert')
    expect(parts[1].value).toContain('A&amp;B &lt;채용팀&gt;')
  })

  it('folds long Unicode subject headers without splitting characters', async () => {
    const mock = mockGoogle()
    const subject = '면접 안내 📋 '.repeat(40)
    await sendFinalOfferEmail(env, { ...message, subject })
    const mime = mimeFrom(mock)
    const subjectHeader = mime.split('Subject: ')[1].split('\r\nDate:')[0]
    expect(decodeWords(subjectHeader)).toBe(subject)
    for (const line of mime.split('\r\n')) expect(line.length).toBeLessThan(998)
    for (const word of subjectHeader.match(/=\?UTF-8\?B\?[^?]+\?=/g)) expect(word.length).toBeLessThanOrEqual(75)
  })

  it.each([
    ['subject', '제목\r\nBcc: extra@example.com'],
    ['to', 'candidate@example.com,extra@example.com'],
    ['to', 'candidate@example.com\r\nBcc: extra@example.com'],
    ['companyName', '회사\nInjected: value'],
  ])('rejects injected %s before any external request', async (field, value) => {
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    await expect(sendFinalOfferEmail({ ...env, FINAL_OFFER_FROM_NAME: '' }, { ...message, [field]: value })).rejects.toThrow()
    expect(mock).not.toHaveBeenCalled()
  })

  it('preserves the signed PDF bytes and RFC 2231 Korean filename', async () => {
    const mock = mockGoogle()
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 0xff, 0x80, 0x0a])
    const filename = '서명 완료 근로계약서 📋.pdf'
    await sendSignedContractEmail(env, { to: message.to, companyName: '회사', pdfBase64: bytes.toString('base64'), filename })
    const mime = mimeFrom(mock)
    expect(mime).toContain('Content-Type: multipart/mixed;')
    const attachment = mime.split('Content-Type: application/pdf\r\n')[1]
    const [headers, body] = attachment.split('\r\n\r\n')
    const encodedName = [...headers.matchAll(/filename\*\d+\*=([^\r\n;]+)/g)].map((match) => match[1]).join('').replace("UTF-8''", '')
    expect(decodeURIComponent(encodedName)).toBe(filename)
    expect(Buffer.from(body.split('\r\n--')[0], 'base64')).toEqual(bytes)
    expect(textParts(mime)).toHaveLength(2)
  })

  it.each(['%%%', 'AA=A', '====', 'AAA', 'A=AA'])('rejects malformed attachment %s', async (pdfBase64) => {
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    await expect(sendSignedContractEmail(env, { to: message.to, companyName: '회사', pdfBase64 })).rejects.toThrow('첨부 파일')
    expect(mock).not.toHaveBeenCalled()
  })

  it('rejects oversized PDFs and filename injection before OAuth', async () => {
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)
    await expect(sendSignedContractEmail(env, { to: message.to, pdfBase64: 'A'.repeat(4 * Math.ceil((8 * 1024 * 1024 + 1) / 3)) })).rejects.toThrow('8MB')
    await expect(sendSignedContractEmail(env, { to: message.to, pdfBase64: 'YQ==', filename: 'x.pdf\r\nBcc: x@example.com' })).rejects.toThrow('제어 문자')
    expect(mock).not.toHaveBeenCalled()
  })

  it.each([
    [sendRoomInviteEmail, message, '면접방 참여 안내'],
    [sendNewMessageEmail, { to: message.to, companyName: '회사', roomTitle: '면접' }, '새 메시지를 남겼습니다'],
    [sendApplicationResultEmail, { to: message.to, companyName: '회사', applicantName: '지원자', result: 'passed', inviteCode: 'AC3KM7PQ4RTV' }, 'AC3K-M7PQ-4RTV'],
    [sendApplicationResultEmail, { to: message.to, companyName: '회사', applicantName: '지원자', result: 'rejected' }, '서류 전형에 지원해 주셔서'],
  ])('routes existing email helpers through Gmail', async (send, data, expected) => {
    const mock = mockGoogle()
    await send(env, data)
    expect(textParts(mimeFrom(mock)).map((part) => part.value).join(' ')).toContain(expected)
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('explains revoked refresh tokens without exposing provider details', async () => {
    const mock = vi.fn().mockResolvedValue(json({ error: 'invalid_grant', error_description: 'private-provider-detail' }, 400))
    vi.stubGlobal('fetch', mock)
    await expect(sendFinalOfferEmail(env, message)).rejects.toThrow('다시 연결')
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it.each([401, 403, 429, 500])('rejects Gmail HTTP %s without provider body or automatic resend', async (status) => {
    const mock = vi.fn().mockResolvedValueOnce(json({ access_token: 'test-access' }))
      .mockResolvedValueOnce(json({ error: { message: 'private-provider-detail' } }, status))
    vi.stubGlobal('fetch', mock)
    const error = await sendFinalOfferEmail(env, message).catch((value) => value)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('Gmail')
    expect(error.message).not.toContain('private-provider-detail')
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it.each([{}, { access_token: 'bad\r\ntoken' }])('rejects an invalid OAuth success response', async (response) => {
    const mock = vi.fn().mockResolvedValue(json(response))
    vi.stubGlobal('fetch', mock)
    await expect(sendFinalOfferEmail(env, message)).rejects.toThrow('인증 응답')
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('does not claim success for a missing Gmail message id', async () => {
    const mock = vi.fn().mockResolvedValueOnce(json({ access_token: 'test-access' })).mockResolvedValueOnce(json({}))
    vi.stubGlobal('fetch', mock)
    await expect(sendFinalOfferEmail(env, message)).rejects.toThrow('보낸메일함')
  })

  it('treats a network failure during sending as unknown and never retries', async () => {
    const mock = vi.fn().mockResolvedValueOnce(json({ access_token: 'test-access' }))
      .mockRejectedValueOnce(new Error('private-network-detail'))
    vi.stubGlobal('fetch', mock)
    await expect(sendFinalOfferEmail(env, message)).rejects.toThrow('보낸메일함')
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('aborts stalled requests with a bounded timeout and no leaked network details', async () => {
    vi.useFakeTimers()
    const mock = vi.fn().mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('private-network-detail')), { once: true })
    }))
    vi.stubGlobal('fetch', mock)
    const check = expect(sendFinalOfferEmail(env, message)).rejects.toThrow('인증 서버')
    await vi.advanceTimersByTimeAsync(20_000)
    await check
    expect(mock).toHaveBeenCalledTimes(1)
  })
})
