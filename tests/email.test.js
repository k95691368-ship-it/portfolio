import { describe, expect, it, vi } from 'vitest'
import { buildFinalOfferEmailHtml, maskEmail, sendFinalOfferEmail } from '../functions/_lib/email.js'

describe('final offer email helpers', () => {
  it('masks the candidate email address', () => {
    expect(maskEmail('candidate@example.com')).toBe('ca*******@example.com')
    expect(maskEmail('a@example.com')).toBe('a*@example.com')
    expect(maskEmail('invalid')).toBe('')
  })

  it('escapes user-controlled HTML and preserves line breaks', () => {
    const html = buildFinalOfferEmailHtml({
      bodyText: '합격을 축하합니다.\n<script>alert("x")</script>',
      companyName: 'A&B <채용팀>',
    })

    expect(html).toContain('합격을 축하합니다.<br>&lt;script&gt;')
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('A&amp;B &lt;채용팀&gt;')
  })

  it('sends through the Resend API with the configured sender information', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'email_123' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const env = {
      RESEND_API_KEY: 're_test_key',
      FINAL_OFFER_FROM_EMAIL: 'recruiting@example.com',
      FINAL_OFFER_FROM_NAME: '채용팀',
    }

    await sendFinalOfferEmail(env, {
      to: 'candidate@example.com',
      subject: '최종 합격 안내',
      bodyText: '합격을 축하합니다.',
      companyName: '테스트 회사',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer re_test_key' }),
      })
    )
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sentBody.to).toBe('candidate@example.com')
    expect(sentBody.from).toBe('채용팀 <recruiting@example.com>')
    expect(sentBody.subject).toBe('최종 합격 안내')
    expect(sentBody.text).toBe('합격을 축하합니다.')

    vi.unstubAllGlobals()
  })

  it('fails clearly when the Resend API key is missing', async () => {
    await expect(
      sendFinalOfferEmail(
        { FINAL_OFFER_FROM_EMAIL: 'recruiting@example.com' },
        {
          to: 'candidate@example.com',
          subject: '최종 합격 안내',
          bodyText: '합격을 축하합니다.',
          companyName: '테스트 회사',
        }
      )
    ).rejects.toThrow('RESEND_API_KEY')
  })
})
