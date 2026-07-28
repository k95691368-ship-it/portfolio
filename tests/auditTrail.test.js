import { describe, expect, it } from 'vitest'
import {
  summarizeUserAgent,
  describeSigningEnvironment,
  buildAuditEvents,
} from '../functions/_lib/auditTrail.js'

describe('summarizeUserAgent', () => {
  it('브라우저와 운영체제만 뽑아낸다', () => {
    expect(
      summarizeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      )
    ).toBe('Chrome · Windows')
    expect(
      summarizeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1 Safari/604.1')
    ).toBe('Safari · iOS')
  })

  it('엣지를 크롬으로 잘못 보지 않는다', () => {
    expect(
      summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 Edg/120.0')
    ).toBe('Edge · Windows')
  })

  it('알 수 없으면 null', () => {
    expect(summarizeUserAgent(null)).toBeNull()
    expect(summarizeUserAgent('curl/8.0')).toBeNull()
  })
})

describe('describeSigningEnvironment', () => {
  it('접속 환경을 한 줄로 정리한다', () => {
    expect(
      describeSigningEnvironment({
        signer_ip: '203.0.113.5',
        signer_user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36',
        signer_country: 'KR',
      })
    ).toBe('IP 203.0.113.5 · Chrome · Windows · KR')
  })

  it('기록이 없으면 null (예전에 서명한 계약)', () => {
    expect(describeSigningEnvironment({})).toBeNull()
  })
})

describe('buildAuditEvents', () => {
  const base = {
    room: { title: '면접방', created_at: '2026-01-01 10:00:00' },
    participants: [
      { display_name: '회사', role_in_room: 'company', joined_at: '2026-01-01 10:00:00' },
      { display_name: '지원자', role_in_room: 'candidate', joined_at: '2026-01-01 10:05:00' },
    ],
    terms: null,
    history: [],
    signatures: [],
    signedContract: null,
    finalOffer: null,
  }

  it('시간순으로 정렬한다', () => {
    const events = buildAuditEvents({
      ...base,
      terms: { hire_confirmed_at: '2026-01-01T09:00:00.000Z' },
    })
    const times = events.map((e) => e.at)
    expect(times).toEqual([...times].sort())
  })

  it('서명 기록에 접속 환경을 함께 남긴다', () => {
    const events = buildAuditEvents({
      ...base,
      signatures: [
        {
          signer_role: 'candidate',
          signed_at: '2026-01-02 10:00:00',
          display_name: '지원자',
          signer_ip: '203.0.113.5',
          signer_user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36',
          signer_country: 'KR',
        },
      ],
    })
    const sign = events.find((e) => e.event === '지원자 서명')
    expect(sign.detail).toContain('지원자')
    expect(sign.detail).toContain('203.0.113.5')
    expect(sign.detail).toContain('Chrome')
  })

  it('환경 기록이 없는 예전 서명도 이름만으로 남긴다', () => {
    const events = buildAuditEvents({
      ...base,
      signatures: [
        { signer_role: 'company', signed_at: '2026-01-02 10:00:00', display_name: '회사' },
      ],
    })
    expect(events.find((e) => e.event === '회사 서명').detail).toBe('회사')
  })
})
