// 아직 계약서가 아닌 것을 계약서처럼 점검한다.
//
// 법령 점검은 계약서에 값이 다 채워진 뒤라야 돌았다. 그런데 조건은 계약서에
// 적히기 훨씬 전에 대화에서 정해지고, 확정된 뒤에 고치는 것은 이 앱이 막으려는
// 실질적 취소다. 그러니 확정 전에 봐야 한다.
import { describe, expect, it } from 'vitest'
import {
  termsFromNegotiation,
  pendingAgreements,
  checkNegotiatedTerms,
  candidateRequests,
} from '../functions/_lib/negotiationCheck.js'

const row = (field, value, extra = {}) => ({ field, value, ...extra })

describe('협의 이력을 계약 조건 모양으로', () => {
  it('항목별 마지막 값을 세운다', () => {
    const t = termsFromNegotiation([
      row('wageBaseAmount', '2900000'),
      row('wageBaseAmount', '2600000'),
      row('workDays', '주 5일'),
    ])
    expect(t.wageBaseAmount).toBe(2600000)
    expect(t.workDays).toBe('주 5일')
  })

  // 협의 이력은 "09:00~18:00" 한 덩어리지만 계산은 시작·종료를 따로 본다.
  it('근무시간은 시작과 종료로 나눈다', () => {
    const t = termsFromNegotiation([row('workHours', '09:00~18:00')])
    expect(t.workHoursStart).toBe('09:00')
    expect(t.workHoursEnd).toBe('18:00')
  })

  it('계약서에 이미 저장된 값을 바닥에 깔고 대화 값으로 덮는다', () => {
    const t = termsFromNegotiation([row('wageBaseAmount', '3000000')], {
      employerName: '한빛테크',
      wageBaseAmount: 2000000,
    })
    expect(t.employerName).toBe('한빛테크')
    expect(t.wageBaseAmount).toBe(3000000)
  })

  it('계약서가 아직 없어도 돈다', () => {
    expect(termsFromNegotiation([], null)).toEqual({})
    expect(termsFromNegotiation(undefined, null)).toEqual({})
  })
})

describe('아직 정해지지 않은 것', () => {
  // 계약서에서 비어 있는 것은 누락이지만, 협의 중에 비어 있는 것은 아직 남은
  // 일이다. 위반으로 세면 협의 초반에 화면이 경고로 가득 차고, 그러면 진짜
  // 경고까지 함께 무시된다.
  it('비어 있는 필수 항목을 남은 일로 모은다', () => {
    const pending = pendingAgreements({ wageBaseAmount: 3000000 })
    const fields = pending.map((p) => p.field)
    expect(fields).toContain('employeeName')
    expect(fields).toContain('workDays')
    expect(fields).not.toContain('wageBaseAmount')
  })
})

describe('지금 합의된 값으로 계약하면', () => {
  const LOW_WAGE = {
    employerName: 'A',
    employeeName: 'B',
    contractStartDate: '2026-09-01',
    workLocation: '서울',
    jobDescription: '운영',
    workHoursStart: '09:00',
    workHoursEnd: '18:00',
    workDays: '주 5일',
    restDays: '토·일',
    wageBaseAmount: 1000000,
    wagePayMethod: '계좌이체',
    wagePayDate: '매월 25일',
    annualLeave: '근로기준법에 따름',
  }

  it('계약서 점검과 같은 위반을 잡는다', () => {
    const r = checkNegotiatedTerms(LOW_WAGE)
    expect(r.issues.some((i) => i.title.includes('최저임금'))).toBe(true)
    expect(r.counts.high).toBeGreaterThan(0)
    expect(r.ready).toBe(false)
  })

  it('남은 것이 없고 위법도 없으면 써도 된다고 말한다', () => {
    const r = checkNegotiatedTerms({ ...LOW_WAGE, wageBaseAmount: 3000000 })
    expect(r.counts.high).toBe(0)
    expect(r.counts.pending).toBe(0)
    expect(r.ready).toBe(true)
  })

  it('필수 항목이 비면 아직이라고 말한다', () => {
    const r = checkNegotiatedTerms({ wageBaseAmount: 3000000 })
    expect(r.ready).toBe(false)
    expect(r.counts.pending).toBeGreaterThan(0)
  })

  it('공고가 있으면 함께 대조한다', () => {
    const r = checkNegotiatedTerms(
      { ...LOW_WAGE, wageBaseAmount: 2200000 },
      { wage_type: 'monthly', wage_min: 2800000 }
    )
    expect(r.postingComparison).not.toBeNull()
    expect(r.postingComparison.issues.length).toBeGreaterThan(0)
  })

  it('공고가 없으면 대조하지 않는다', () => {
    expect(checkNegotiatedTerms(LOW_WAGE).postingComparison).toBeNull()
  })

  it('값이 하나도 없어도 무너지지 않는다', () => {
    const r = checkNegotiatedTerms({})
    expect(r.ready).toBe(false)
    expect(Array.isArray(r.issues)).toBe(true)
  })
})

describe('근무시간 이력이 온전하지 않을 때', () => {
  // 한쪽만 세우면 시각이 적혀 있는 것처럼 보여 필수 항목 검사를 통과하는데
  // 주 근로시간은 계산되지 않는다 — 값은 있는데 계산은 꺼진다.
  it('시작이나 종료 한쪽만 있으면 세우지 않는다', () => {
    expect(termsFromNegotiation([row('workHours', '09:00')]).workHoursStart).toBeUndefined()
    expect(termsFromNegotiation([row('workHours', '~18:00')]).workHoursEnd).toBeUndefined()
  })

  it('구분자가 여럿이면 세우지 않는다', () => {
    const t = termsFromNegotiation([row('workHours', '09:00~18:00~20:00')])
    expect(t.workHoursStart).toBeUndefined()
    expect(t.workHoursEnd).toBeUndefined()
  })

  it('온전한 값은 시작과 종료로 나눈다', () => {
    const t = termsFromNegotiation([row('workHours', '09:00~18:00')])
    expect(t.workHoursStart).toBe('09:00')
    expect(t.workHoursEnd).toBe('18:00')
  })
})

// 협의는 두 사람이 서로 다른 값을 말하는 자리다. 발화자를 지우면 그 자리가
// 사라지고, 아무도 제안하지 않은 금액으로 위법 여부를 판정하게 된다.
describe('누가 말한 값인가', () => {
  const row = (role, field, value, display) => ({
    speaker_role: role, field, value, value_display: display ?? value,
  })

  it('지원자의 희망 조건이 회사의 저장된 값을 덮지 않는다', () => {
    const terms = termsFromNegotiation(
      [row('company', 'wageBaseAmount', '2900000'), row('candidate', 'wageBaseAmount', '4000000')],
      { wageBaseAmount: 2900000 }
    )
    expect(terms.wageBaseAmount).toBe(2900000)
  })

  it('회사가 말한 값은 계약서 저장값을 덮는다', () => {
    const terms = termsFromNegotiation([row('company', 'wageBaseAmount', '3100000')], {
      wageBaseAmount: 2900000,
    })
    expect(terms.wageBaseAmount).toBe(3100000)
  })

  it('지원자가 다르게 말한 항목은 따로 모아 보여 준다', () => {
    const rows = [row('company', 'wageBaseAmount', '2900000'), row('candidate', 'wageBaseAmount', '4000000', '4,000,000원')]
    const terms = termsFromNegotiation(rows, {})
    const asked = candidateRequests(rows, terms)
    expect(asked).toHaveLength(1)
    expect(asked[0].requested).toBe('4,000,000원')
    expect(asked[0].current).toBe('2900000')
  })

  it('같은 값을 말했으면 이견이 아니다', () => {
    const rows = [row('company', 'workDays', '주 5일'), row('candidate', 'workDays', '주 5일')]
    expect(candidateRequests(rows, termsFromNegotiation(rows, {}))).toHaveLength(0)
  })
})

// 공고와 어긋난 것도 위법이다(채용절차법 제4조 제3항). 스스로 계산해 놓고
// 판정에서 빼면, 경고와 '써도 됩니다'가 한 화면에 나란히 뜬다.
describe('공고 위반이 판정에 들어간다', () => {
  const full = {
    employerName: '회사', employeeName: '지원자', contractStartDate: '2026-09-01',
    workLocation: '서울', jobDescription: '사무', workHoursStart: '09:00',
    workHoursEnd: '18:00', workDays: '주 5일', restDays: '토, 일',
    wageType: 'monthly', wageBaseAmount: 2500000, wagePayDate: '매월 10일',
    breakTime: '12:00~13:00',
  }

  it('공고보다 불리한 조건이면 아직 계약서를 쓸 때가 아니다', () => {
    const posting = { wage_type: 'monthly', wage_min: 3000000, wage_max: 3200000 }
    const r = checkNegotiatedTerms(full, posting)
    const highs = r.postingComparison.issues.filter((i) => i.severity === 'high')
    expect(highs.length).toBeGreaterThan(0)
    expect(r.ready).toBe(false)
    expect(r.counts.high).toBeGreaterThanOrEqual(highs.length)
  })
})

// 계약서 화면은 계속근로 2년 초과를 검사하는데 계약 전 검토는 하지 않았다.
// 같은 방을 두고 두 화면의 판정이 갈리면, 둘 중 하나는 반드시 거짓말이다.
describe('바깥 사실이 있어야 나오는 판정', () => {
  const full = {
    employerName: '회사', employeeName: '지원자', contractStartDate: '2026-09-01',
    workLocation: '서울', jobDescription: '사무', workHoursStart: '09:00',
    workHoursEnd: '18:00', workDays: '주 5일', restDays: '토, 일',
    wageType: 'monthly', wageBaseAmount: 2500000, wagePayDate: '매월 10일',
    breakTime: '12:00~13:00',
  }

  it('호출부가 넣어 준 위반이 판정에 함께 들어간다', () => {
    const extra = [{ severity: 'high', title: '계속근로 2년 초과', detail: '기간제법 제4조' }]
    const r = checkNegotiatedTerms(full, null, extra)
    expect(r.issues).toContainEqual(extra[0])
    expect(r.ready).toBe(false)
    expect(r.counts.high).toBeGreaterThanOrEqual(1)
  })

  it('넣지 않으면 예전과 같다', () => {
    expect(checkNegotiatedTerms(full, null).issues).toEqual(checkNegotiatedTerms(full, null, []).issues)
  })
})
