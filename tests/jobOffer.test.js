// 채용내정이 성립했는가, 그리고 그것을 취소하면 무슨 일이 벌어지는가.
//
// 이 서비스가 존재하는 이유가 여기다. 회사는 자기가 이미 선을 넘었다는 것을
// 모른 채 취소하고, 그래서 손해배상을 문다.
import { describe, expect, it } from 'vitest'
import {
  scanForOfferSignals,
  describeOfferStatus,
  describeCancellationRisk,
  describeUnfavourableChanges,
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

// 내정 취소는 "없던 일로 합시다"로만 일어나지 않는다. 임금을 깎거나 출근일을
// 미뤄 지원자가 스스로 포기하게 만드는 쪽이 실무에서 더 흔하고, 회사는 그것을
// 취소라고 자각하지 못한다.
describe('확정 뒤의 불리한 조건 변경', () => {
  it('임금이 낮아지면 얼마나 낮아졌는지까지 짚는다', () => {
    const [c] = describeUnfavourableChanges([
      { field: 'wageBaseAmount', from: 3000000, to: 2500000 },
    ])
    expect(c.label).toBe('임금')
    expect(c.detail).toContain('500,000원')
  })

  it('임금이 오르는 것은 잡지 않는다', () => {
    expect(
      describeUnfavourableChanges([{ field: 'wageBaseAmount', from: 2500000, to: 3000000 }])
    ).toHaveLength(0)
  })

  it('출근일이 뒤로 밀리면 잡는다', () => {
    const found = describeUnfavourableChanges([
      { field: 'contractStartDate', from: '2026-09-01', to: '2026-11-01' },
    ])
    expect(found).toHaveLength(1)
    // 앞당기는 것은 불리하지 않다.
    expect(
      describeUnfavourableChanges([
        { field: 'contractStartDate', from: '2026-11-01', to: '2026-09-01' },
      ])
    ).toHaveLength(0)
  })

  it('계약 종료일이 앞당겨지면 잡는다', () => {
    expect(
      describeUnfavourableChanges([
        { field: 'contractEndDate', from: '2027-08-31', to: '2027-02-28' },
      ])
    ).toHaveLength(1)
  })

  it('상관없는 항목은 잡지 않는다', () => {
    expect(
      describeUnfavourableChanges([{ field: 'workLocation', from: '서울', to: '부산' }])
    ).toHaveLength(0)
  })

  it('금액에 콤마나 원이 붙어 있어도 읽는다', () => {
    expect(
      describeUnfavourableChanges([
        { field: 'wageBaseAmount', from: '3,000,000원', to: '2,500,000' },
      ])
    ).toHaveLength(1)
  })
})

// 워크플로우가 찾은 것들. 없는 확정을 만들면 회사가 방을 닫지 못하고,
// 감사 증명서에는 있지도 않았던 채용내정의 취소가 기록된다.
describe('확정이 아닌 문장을 확정으로 읽지 않는다', () => {
  const co = (body) => ({ role_in_room: 'company', body })
  const established = (body) =>
    describeOfferStatus({ terms: {}, messages: [co(body)] }).established

  // '불합격'의 뒤 두 글자가 '합격'에 그대로 걸렸다. 채용절차법 제10조에 따라
  // 불합격을 통지한 회사가 그 방을 닫지 못하게 된다.
  it('불합격 통보', () => {
    expect(established('아쉽지만 이번 채용에서는 불합격입니다.')).toBe(false)
    expect(established('불합격입니다. 좋은 결과 있으시길 바랍니다.')).toBe(false)
  })

  it('아직 알리지 않겠다는 예고', () => {
    expect(established('합격 여부는 다음 주에 알려드립니다.')).toBe(false)
    expect(established('합격자 발표는 다음 주입니다.')).toBe(false)
    expect(established('최종 합격자 발표는 아직입니다.')).toBe(false)
  })

  it('확정을 부정하는 문장', () => {
    expect(established('합격이 아닙니다.')).toBe(false)
    expect(established('아직 채용을 확정하지 않았습니다.')).toBe(false)
    expect(established('입사일은 아직 정해지지 않았습니다.')).toBe(false)
    expect(established('출근하시면 안 됩니다.')).toBe(false)
  })

  // 취소를 검토한다는 말 자체가 내정 성립 판정을 만들고, 그 문장이
  // "확정으로 본 근거"로 인용됐다.
  it('취소를 검토한다는 말', () => {
    expect(established('내정 취소를 검토 중입니다.')).toBe(false)
  })
})

describe('흔한 확정 표현을 놓치지 않는다', () => {
  const co = (body) => ({ role_in_room: 'company', body })
  const established = (body) =>
    describeOfferStatus({ terms: {}, messages: [co(body)] }).established

  it.each([
    '채용을 결정했습니다.',
    '다음 주 월요일부터 나오시죠.',
    '오퍼 드립니다. 검토해주세요.',
    '뽑기로 했습니다.',
    '9월 1일자로 발령 예정입니다.',
    '입사일 9월 1일로 하시죠.',
    '출근일은 9월 1일입니다.',
    '함께 일하게 되어 기쁩니다.',
    '최종 합격하셨습니다.',
  ])('%s', (body) => {
    expect(established(body)).toBe(true)
  })
})

describe('근거로 인용하는 문장', () => {
  const co = (body, at) => ({ role_in_room: 'company', body, created_at: at })

  // 확정을 성립시킨 것은 처음 그렇게 말한 문장이다. 시각과 인용문이 서로 다른
  // 메시지를 가리키면 "언제 무슨 말로 확정됐는가"가 어긋난다.
  it('처음 확정을 말한 문장을 인용한다', () => {
    const o = describeOfferStatus({
      terms: {},
      messages: [
        co('최종 합격하셨습니다.', '2026-09-01 10:00:00'),
        co('9월 1일부터 출근해 주세요.', '2026-09-02 10:00:00'),
      ],
    })
    expect(o.excerpt).toContain('최종 합격')
    expect(o.at).toBe('2026-09-01 10:00:00')
  })
})
