import { describe, expect, it, vi } from 'vitest'
import { maskEmail, sendFinalOfferEmail } from '../functions/_lib/email.js'

describe('final offer email helpers', () => {
  it('masks the candidate email address', () => {
    expect(maskEmail('candidate@example.com')).toBe('ca*******@example.com')
    expect(maskEmail('a@example.com')).toBe('a*@example.com')
    expect(maskEmail('invalid')).toBe('')
  })

  // 템플릿 함수를 직접 부르지 않고 실제 발송 경로를 통해 확인한다.
  // 내부 함수를 테스트하려고 export 를 열어 두면, 쓰지도 않는 공개 표면이 남는다.
  it('escapes user-controlled HTML and preserves line breaks', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Messages: [{ Status: 'success' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await sendFinalOfferEmail(
      {
        MAILJET_API_KEY: 'k',
        MAILJET_SECRET_KEY: 's',
        FINAL_OFFER_FROM_EMAIL: 'recruiting@example.com',
      },
      {
        to: 'candidate@example.com',
        subject: '최종 합격 안내',
        bodyText: '합격을 축하합니다.\n<script>alert("x")</script>',
        companyName: 'A&B <채용팀>',
      }
    )

    const html = JSON.parse(fetchMock.mock.calls[0][1].body).Messages[0].HTMLPart
    expect(html).toContain('합격을 축하합니다.<br>&lt;script&gt;')
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('A&amp;B &lt;채용팀&gt;')

    vi.unstubAllGlobals()
  })

  it('sends through the Mailjet API with the configured sender information', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Messages: [{ Status: 'success' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const env = {
      MAILJET_API_KEY: 'mj_key',
      MAILJET_SECRET_KEY: 'mj_secret',
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
      'https://api.mailjet.com/v3.1/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: `Basic ${btoa('mj_key:mj_secret')}` }),
      })
    )
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    const message = sentBody.Messages[0]
    expect(message.To[0].Email).toBe('candidate@example.com')
    expect(message.From.Email).toBe('recruiting@example.com')
    expect(message.From.Name).toBe('채용팀')
    expect(message.Subject).toBe('최종 합격 안내')
    expect(message.TextPart).toBe('합격을 축하합니다.')

    vi.unstubAllGlobals()
  })

  it('rejects when Mailjet reports a per-message error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Messages: [{ Status: 'error', Errors: [{ ErrorMessage: 'bad sender' }] }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      sendFinalOfferEmail(
        {
          MAILJET_API_KEY: 'k',
          MAILJET_SECRET_KEY: 's',
          FINAL_OFFER_FROM_EMAIL: 'recruiting@example.com',
        },
        { to: 'a@b.com', subject: 's', bodyText: 'b', companyName: 'c' }
      )
    ).rejects.toThrow('Mailjet 발송 실패')

    vi.unstubAllGlobals()
  })

  it('fails clearly when the Mailjet API key is missing', async () => {
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
    ).rejects.toThrow('MAILJET_API_KEY')
  })
})
