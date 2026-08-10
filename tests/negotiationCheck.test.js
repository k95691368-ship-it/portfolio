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
