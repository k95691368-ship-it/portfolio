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

  // 이 사건들은 각자의 표에는 남아 있었지만 타임라인에는 없었다.
  // 이력을 증명한다면서 이력의 절반을 빠뜨리는 문서였다.
  it('서명 무효화를 사유와 함께 남긴다', () => {
    const events = buildAuditEvents({
      ...base,
      revocations: [
        {
          signer_role: 'candidate',
          revoked_at: '2026-01-03 09:00:00',
          reason: '계약 내용 변경',
        },
      ],
    })
    const e = events.find((x) => x.event === '지원자 서명 무효화')
    expect(e).toBeTruthy()
    expect(e.detail).toBe('계약 내용 변경')
  })

  it('수정 요청과 회신을 각각 남긴다', () => {
    const events = buildAuditEvents({
      ...base,
      changeRequests: [
        {
          field: 'wageBaseAmount',
          label: '임금(월 기본급)',
          status: 'accepted',
          createdAt: '2026-01-02 11:00:00',
          resolvedAt: '2026-01-02 12:00:00',
        },
        {
          field: 'workLocation',
          label: '근무 장소',
          status: 'declined',
          createdAt: '2026-01-02 13:00:00',
          resolvedAt: '2026-01-02 14:00:00',
        },
      ],
    })
    expect(events.filter((e) => e.event === '계약 조건 수정 요청')).toHaveLength(2)
    expect(events.find((e) => e.event === '수정 요청 수락').detail).toBe('임금(월 기본급)')
    expect(events.find((e) => e.event === '수정 요청 반려').detail).toBe('근무 장소')
  })

  // 증명서는 계약 당사자가 아닌 사람에게 제시된다. 발급번호를 아는 것만으로
  // 남의 임금이 보여서는 안 되므로, 이력에는 항목 이름까지만 담는다.
  it('수정 요청 이력에 요청한 값을 담지 않는다', () => {
    const events = buildAuditEvents({
      ...base,
      changeRequests: [
        {
          field: 'wageBaseAmount',
          label: '임금(월 기본급)',
          currentValue: '1700000',
          requestedValue: '2156880',
          reason: '최저임금 미달입니다',
          status: 'accepted',
          createdAt: '2026-01-02 11:00:00',
          resolvedAt: '2026-01-02 12:00:00',
        },
      ],
    })
    const text = JSON.stringify(events)
    expect(text).not.toContain('1700000')
    expect(text).not.toContain('2156880')
    expect(text).not.toContain('최저임금 미달입니다')
  })

  it('교부와 근로자 열람·내려받기를 각각 남긴다', () => {
    const events = buildAuditEvents({
      ...base,
      deliveries: [
        {
          channel: 'in_app',
          channelLabel: '앱에서 열람 가능',
          status: 'delivered',
          deliveredAt: '2026-01-03 10:00:00',
          firstViewedAt: '2026-01-03 11:00:00',
          downloadedAt: '2026-01-03 12:00:00',
        },
      ],
    })
    expect(events.find((e) => e.event === '계약서 교부').detail).toBe('앱에서 열람 가능')
    expect(events.find((e) => e.event === '근로자 계약서 열람').at).toBe('2026-01-03 11:00:00')
    expect(events.find((e) => e.event === '근로자 계약서 내려받음').at).toBe('2026-01-03 12:00:00')
  })

  it('발송이 실패한 교부는 교부로 적지 않는다', () => {
    const events = buildAuditEvents({
      ...base,
      deliveries: [
        { channel: 'email', channelLabel: '이메일 발송', status: 'failed', deliveredAt: '2026-01-03 10:00:00' },
      ],
    })
    expect(events.find((e) => e.event === '계약서 교부')).toBeUndefined()
    expect(events.find((e) => e.event === '계약서 교부 실패')).toBeTruthy()
  })

  it('외국어 계약서 생성과 증명서 발급을 남긴다', () => {
    const events = buildAuditEvents({
      ...base,
      translations: [{ language: 'vi', nativeLabel: 'Tiếng Việt', createdAt: '2026-01-02 15:00:00' }],
      certificates: [{ serial: 'AC-ABCD-EFGH-JKMN', issuedAt: '2026-01-04 09:00:00' }],
    })
    expect(events.find((e) => e.event === '외국어 계약서 생성').detail).toBe('Tiếng Việt')
    expect(events.find((e) => e.event === '감사추적증명서 발급').detail).toBe('AC-ABCD-EFGH-JKMN')
  })

  it('시각 없는 사건은 이력에 넣지 않는다', () => {
    const events = buildAuditEvents({
      ...base,
      certificates: [{ serial: 'AC-NONE-NONE-NONE', issuedAt: null }],
    })
    expect(events.find((e) => e.event === '감사추적증명서 발급')).toBeUndefined()
    expect(events.every((e) => e.at !== '')).toBe(true)
  })

  it('모든 사건이 뒤섞여도 시간순을 지킨다', () => {
    const events = buildAuditEvents({
      ...base,
      signatures: [
        { signer_role: 'company', signed_at: '2026-01-02 16:00:00', display_name: '회사' },
      ],
      changeRequests: [
        { field: 'workLocation', label: '근무 장소', status: 'accepted', createdAt: '2026-01-02 11:00:00', resolvedAt: '2026-01-02 12:00:00' },
      ],
      revocations: [{ signer_role: 'company', revoked_at: '2026-01-03 09:00:00', reason: '계약 내용 변경' }],
      deliveries: [{ channel: 'in_app', channelLabel: '앱', status: 'delivered', deliveredAt: '2026-01-04 10:00:00' }],
      certificates: [{ serial: 'AC-ABCD-EFGH-JKMN', issuedAt: '2026-01-05 09:00:00' }],
    })
    const times = events.map((e) => e.at)
    expect(times).toEqual([...times].sort())
  })
})
