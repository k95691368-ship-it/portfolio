// 채용내정의 성립 시점은 회사가 "채용하겠다"는 뜻을 알린 때다.
// 그 알림의 가장 전형적인 형태가 최종합격 통보 메일이다.
import { describe, expect, it } from 'vitest'
import { offerExcerptFromEmail } from '../functions/_lib/offerFromEmail.js'

describe('메일 발송을 확정의 근거로 남기기', () => {
  // 나중에 "언제 무엇으로 확정됐는가"를 다투는 자리에서 읽히는 문장이다.
  // 메일이라는 사실과 수신자·제목·시각이 함께 있어야 근거가 된다.
  it('수신자·제목·시각을 함께 남긴다', () => {
    const excerpt = offerExcerptFromEmail({
      recipientEmail: 'a@b.com',
      subject: '최종 합격을 축하드립니다',
      sentAt: '2026-08-13 09:00:00',
    })
    expect(excerpt).toContain('최종합격 이메일 발송')
    expect(excerpt).toContain('a@b.com')
    expect(excerpt).toContain('최종 합격을 축하드립니다')
    expect(excerpt).toContain('2026-08-13 09:00:00')
  })

  it('일부가 없어도 무너지지 않는다', () => {
    expect(offerExcerptFromEmail({})).toBe('최종합격 이메일 발송')
    expect(offerExcerptFromEmail({ recipientEmail: 'a@b.com' })).toContain('a@b.com')
  })

  // 제목은 회사가 자유롭게 적는다. 근거 문장이 통째로 길어지면 화면에서
  // 잘려 정작 무엇이 근거인지 안 보인다.
  it('긴 제목은 잘라 담는다', () => {
    const excerpt = offerExcerptFromEmail({ subject: '가'.repeat(300) })
    expect(excerpt.length).toBeLessThan(200)
  })
})
