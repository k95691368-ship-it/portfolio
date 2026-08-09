// 채용내정이 성립했는가, 그리고 그것을 취소하면 무슨 일이 벌어지는가.
//
// 이 서비스가 존재하는 이유가 여기다. 회사는 자기가 이미 선을 넘었다는 것을
// 모른 채 취소하고, 그래서 손해배상을 문다.
import { describe, expect, it } from 'vitest'
import {
  scanForOfferSignals,
  describeOfferStatus,
  describeCancellationRisk,
} from '../functions/_lib/jobOffer.js'

const msg = (role, body) => ({ role_in_room: role, body, created_at: '2026-09-01 10:00:00' })

describe('대화 감시', () => {
  it('회사가 출근일을 말하면 확정 신호로 잡는다', () => {
    const s = scanForOfferSignals([
      msg('candidate', '안녕하세요'),
      msg('company', '다음 주 월요일부터 출근해 주세요.'),
    ])
    expect(s.strong).toHaveLength(1)
    expect(s.strong[0].text).toContain('출근해 주세요')
  })

  it('합격 통보를 잡는다', () => {
    expect(scanForOfferSignals([msg('company', '최종 합격하셨습니다.')]).strong).toHaveLength(1)
  })

  // 확정은 회사만 할 수 있다. 지원자의 질문을 확정으로 읽으면 안 된다.
  it('지원자가 같은 말을 해도 확정으로 읽지 않는다', () => {
    const s = scanForOfferSignals([msg('candidate', '언제부터 출근하면 되나요? 합격인가요?')])
    expect(s.strong).toHaveLength(0)
    expect(s.weak).toHaveLength(0)
  })

  it('정황 표현은 따로 모은다 — 단정하지 않는다', () => {
    const s = scanForOfferSignals([msg('company', '언제부터 출근 가능하신가요?')])
    expect(s.strong).toHaveLength(0)
    expect(s.weak).toHaveLength(1)
  })
})

describe('내정 성립 판정', () => {
  it('AI 판정이 있으면 그것을 근거로 삼는다', () => {
    const o = describeOfferStatus({
      terms: { hireConfirmed: true, hireConfirmedAt: '2026-09-01', confirmationExcerpt: '9월 1일부터 출근' },
      messages: [],
    })
    expect(o.established).toBe(true)
    expect(o.basis).toBe('ai')
    expect(o.excerpt).toContain('출근')
  })

  // AI 조건 정리는 회사가 버튼을 눌러야 돈다. 누르지 않으면 판정이 없고,
  // 판정이 없으면 경고도 없다. 그것은 감시가 아니다.
  it('AI 판정이 없어도 대화만으로 잡는다', () => {
    const o = describeOfferStatus({
      terms: { hireConfirmed: false },
      messages: [msg('company', '채용하기로 결정했습니다. 계약서 보내드릴게요.')],
    })
    expect(o.established).toBe(true)
    expect(o.basis).toBe('phrase')
    expect(o.excerpt).toContain('채용하기로')
  })

  it('성립하지 않았으면 위험 안내를 붙이지 않는다', () => {
    const o = describeOfferStatus({ terms: { hireConfirmed: false }, messages: [msg('company', '안녕하세요')] })
    expect(o.established).toBe(false)
    expect(o.risk).toBeUndefined()
  })

  it('가까워졌으면 넘기 전에 미리 알린다', () => {
    const o = describeOfferStatus({
      terms: { hireConfirmed: false },
      messages: [msg('company', '언제부터 출근 가능하신가요?')],
    })
    expect(o.established).toBe(false)
    expect(o.likely).toBe(true)
    expect(o.note).toContain('해고')
  })
})

describe('취소하면 무슨 일이 벌어지는가', () => {
  it('해고로 다뤄진다고 알리고 조문을 댄다', () => {
    const r = describeCancellationRisk({ employeeCount: 10 })
    expect(r.isDismissal).toBe(true)
    expect(r.reason).toContain('제23조')
    expect(r.remedies).toContain('노동위원회에 부당해고 구제신청')
  })

  // 4명 이하는 제23조와 구제신청이 적용되지 않는다. 그렇다고 안전하지 않다 —
  // "우리는 작아서 괜찮다"로 읽히면 안 된다.
  it('4명 이하에는 구제신청을 빼되 손해배상은 남는다고 말한다', () => {
    const r = describeCancellationRisk({ employeeCount: 3 })
    expect(r.remedies).not.toContain('노동위원회에 부당해고 구제신청')
    expect(r.remedies).toContain('법원에 손해배상 청구')
    expect(r.scopeNote).toContain('손해배상')
  })

  it('취소가 인정될 수 있는 사유를 함께 알려 준다', () => {
    const r = describeCancellationRisk({})
    expect(r.lawfulGrounds.length).toBeGreaterThan(0)
    expect(r.lawfulGrounds.join(' ')).toContain('졸업')
  })
})

// 호출부에 따라 DB 행이 그대로 오기도 하고 카멜로 바뀌어 오기도 한다.
// 한쪽 이름만 읽으면 확정 여부가 판정에 도달하지 않고, 그러면 이 시스템이
// 하려는 일 전체가 조용히 꺼진다. 실제로 그렇게 한 번 꺼졌다.
describe('행 모양이 달라도 같은 판정', () => {
  const expectSame = (terms) => {
    const o = describeOfferStatus({ terms, messages: [] })
    expect(o.established).toBe(true)
    expect(o.basis).toBe('ai')
    expect(o.excerpt).toContain('9월 1일')
  }

  it('스네이크 행을 그대로 넘겨도 읽는다', () => {
    expectSame({
      hire_confirmed: 1,
      hire_confirmed_at: '2026-09-01',
      hire_confirmation_excerpt: '9월 1일부터 출근하시죠',
    })
  })

  it('카멜로 바꿔 넘겨도 읽는다', () => {
    expectSame({
      hireConfirmed: true,
      hireConfirmedAt: '2026-09-01',
      confirmationExcerpt: '9월 1일부터 출근하시죠',
    })
  })
})
