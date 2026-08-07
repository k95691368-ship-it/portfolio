// 전형 종료와 근로관계 종료가 감사추적에 남는가.
//
// 두 사건 모두 상태 컬럼에만 적히고, 되돌리면 그 컬럼이 지워졌다. 그러면
// "종료했다가 되돌렸다"는 사실이 흔적 없이 사라진다. 채용절차법 제10조의
// 고지 사실과, 보존 기간 3년의 기산일이 걸린 자리다.
import { describe, expect, it } from 'vitest'
import { LIFECYCLE_ACTIONS, lifecycleEvents } from '../functions/_lib/roomLifecycleLog.js'
import { buildAuditEvents } from '../functions/_lib/auditTrail.js'

const ROOM = { id: 'r1', title: '백엔드 개발자 계약', created_at: '2026-08-01 09:00:00', status: 'closed' }

describe('lifecycleEvents', () => {
  it('네 가지 사건을 모두 사람이 읽는 말로 옮긴다', () => {
    expect(Object.keys(LIFECYCLE_ACTIONS).sort()).toEqual([
      'closed',
      'employment_end_cleared',
      'employment_end_recorded',
      'reopened',
    ])
  })

  it('행위자와 사유를 함께 담는다', () => {
    const [e] = lifecycleEvents([
      { action: 'closed', actor_name: '김담당', detail: '다른 지원자를 채용했습니다', created_at: '2026-08-05 10:00:00' },
    ])
    expect(e.event).toBe('전형 종료')
    expect(e.detail).toBe('김담당 · 다른 지원자를 채용했습니다')
    expect(e.at).toBe('2026-08-05 10:00:00')
  })

  it('모르는 행동은 그대로 두되 버리지 않는다', () => {
    const [e] = lifecycleEvents([{ action: 'unknown_thing', created_at: '2026-08-05 10:00:00' }])
    expect(e.event).toBe('unknown_thing')
  })
})

describe('감사추적에 합류', () => {
  const base = {
    room: ROOM,
    participants: [],
    terms: null,
    history: [],
    signatures: [],
    signedContract: null,
    finalOffer: null,
    revocations: [],
    changeRequests: [],
    deliveries: [],
    translations: [],
    certificates: [],
  }

  it('종료와 종료 취소가 둘 다 이력에 남는다', () => {
    const events = buildAuditEvents({
      ...base,
      lifecycle: lifecycleEvents([
        { action: 'closed', actor_name: '김담당', detail: '채용 취소', created_at: '2026-08-05 10:00:00' },
        { action: 'reopened', actor_name: '김담당', detail: null, created_at: '2026-08-06 11:00:00' },
      ]),
    })
    const names = events.map((e) => e.event)
    expect(names).toContain('전형 종료')
    expect(names).toContain('전형 종료 취소')
    // 시각 순서대로 — 되돌린 것이 종료보다 뒤에 온다.
    expect(names.indexOf('전형 종료')).toBeLessThan(names.indexOf('전형 종료 취소'))
  })

  it('기록이 없으면 아무것도 더하지 않는다', () => {
    const before = buildAuditEvents(base).length
    expect(buildAuditEvents({ ...base, lifecycle: [] })).toHaveLength(before)
    expect(buildAuditEvents({ ...base, lifecycle: undefined })).toHaveLength(before)
  })
})
