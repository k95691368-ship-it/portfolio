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
  it('기록하는 사건을 모두 사람이 읽는 말로 옮긴다', () => {
    expect(Object.keys(LIFECYCLE_ACTIONS).sort()).toEqual([
      'archived',
      'closed',
      'employment_end_cleared',
      'employment_end_recorded',
      'offer_confirmed_by_email',
      'offer_withdrawn',
      'reopened',
      'unarchived',
    ])
  })

  // 이름이 행동의 무게를 말해야 한다. 확정 뒤의 종료는 전형 종료가 아니다.
  it('채용 확정 뒤의 종료는 전형 종료와 다른 이름으로 남는다', () => {
    const [e] = lifecycleEvents([
      { action: 'offer_withdrawn', actor_name: '김담당', detail: '채용 취소', created_at: '2026-09-05 10:00:00' },
    ])
    expect(e.event).toContain('채용내정 취소')
    expect(e.event).toContain('해고')
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

// 잠그는 일과 푸는 일은 둘 다 일어난 일이다. 잠겨 있는 동안 무엇을 할 수
// 없었는지가 나중에 다툼의 대상이 된다.
describe('보관 기록', () => {
  it('보관과 해제가 사람이 읽는 말로 남는다', () => {
    const events = lifecycleEvents([
      { action: 'archived', actor_name: '김담당', detail: null, created_at: '2026-08-12 09:00:00' },
      { action: 'unarchived', actor_name: '김담당', detail: null, created_at: '2026-08-12 10:00:00' },
    ])
    expect(events[0].event).toBe('면접방 보관 (대화·계약서 잠금)')
    expect(events[1].event).toBe('면접방 보관 해제')
  })
})

// 최종합격 통보 메일이 나간 순간이 곧 채용내정 성립 시점이다.
// 나중에 "언제 확정됐는가"를 다투는 자리에서 가장 먼저 읽히는 줄이다.
describe('메일로 성립한 채용내정', () => {
  it('무엇으로 확정됐는지가 이름에 남는다', () => {
    const [e] = lifecycleEvents([
      {
        action: 'offer_confirmed_by_email',
        actor_name: '박서준',
        detail: '최종합격 이메일 발송 · 수신 a@b.com',
        created_at: '2026-08-13 09:00:00',
      },
    ])
    expect(e.event).toBe('최종합격 이메일 발송 — 채용내정 성립')
    expect(e.detail).toContain('a@b.com')
  })
})
