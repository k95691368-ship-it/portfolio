// 근로자가 실제로 갖는 권리를 날짜와 금액으로 계산한다.
//
// 계약서에 "근로기준법에 따름"이라고만 적히면 근로자는 아무것도 알 수 없다.
// 이 숫자는 근로자가 회사에 물을 때 쓰는 근거이므로, 법 조문 그대로여야 한다.
import { describe, expect, it } from 'vitest'
import {
  annualLeaveDaysForYear,
  describeAnnualLeave,
  describeSeverance,
  describeOvertimeRates,
  ordinaryWageBase,
  describeWorkerRights,
} from '../functions/_lib/workerRights.js'

const NOW = new Date(Date.UTC(2026, 8, 15)) // 2026-09-15

const FULL_TIME = {
  contractStartDate: '2026-09-01',
  contractEndDate: null,
  workHoursStart: '09:00',
  workHoursEnd: '18:00',
  workDays: '주 5일 (월~금)',
  wageBaseAmount: 2900000,
}

// 주 12시간 — 초단시간 근로자
const SHORT_TIME = {
  ...FULL_TIME,
  workHoursStart: '09:00',
  workHoursEnd: '13:00',
  workDays: '주 3일 (월~수)',
}

describe('연차 일수 (제60조 제4항)', () => {
  // "최초 1년을 초과하는 계속 근로 연수 매 2년에 대하여 1일을 가산"
  // → 3년차부터 2년마다 1일. 3년마다가 아니다.
  it('1~2년차는 15일이다', () => {
    expect(annualLeaveDaysForYear(1)).toBe(15)
    expect(annualLeaveDaysForYear(2)).toBe(15)
  })

  it('3년차부터 2년마다 1일씩 는다', () => {
    expect(annualLeaveDaysForYear(3)).toBe(16)
    expect(annualLeaveDaysForYear(4)).toBe(16)
    expect(annualLeaveDaysForYear(5)).toBe(17)
    expect(annualLeaveDaysForYear(7)).toBe(18)
  })

  it('25일을 넘지 않는다', () => {
    expect(annualLeaveDaysForYear(21)).toBe(25)
    expect(annualLeaveDaysForYear(40)).toBe(25)
  })

  it('1년 미만은 연 단위 연차가 없다', () => {
    expect(annualLeaveDaysForYear(0)).toBe(0)
  })
})

describe('describeAnnualLeave', () => {
  it('1년 미만은 1개월 개근마다 1일씩 최대 11일', () => {
    const a = describeAnnualLeave(FULL_TIME, NOW)
    expect(a.applies).toBe(true)
    expect(a.firstYear).toHaveLength(11)
    expect(a.firstYear[0].at).toBe('2026-10-01')
    expect(a.firstYear[10].cumulative).toBe(11)
  })

  it('1년이 되는 날 15일이 생긴다', () => {
    const a = describeAnnualLeave(FULL_TIME, NOW)
    expect(a.byYear[0].at).toBe('2027-09-01')
    expect(a.byYear[0].days).toBe(15)
  })

  it('다음에 생길 연차를 알려준다', () => {
    expect(describeAnnualLeave(FULL_TIME, NOW).upcoming.at).toBe('2026-10-01')
  })

  // 제18조 제3항: 주 15시간 미만은 연차·주휴 적용 제외
  it('주 15시간 미만이면 적용되지 않는다고 밝힌다', () => {
    const a = describeAnnualLeave(SHORT_TIME, NOW)
    expect(a.applies).toBe(false)
    expect(a.reason).toContain('제18조 제3항')
  })

  it('개시일이 없으면 계산하지 않는다', () => {
    expect(describeAnnualLeave({ ...FULL_TIME, contractStartDate: null }, NOW).known).toBe(false)
  })
})

describe('describeSeverance', () => {
  it('무기계약은 1년 도달일을 알려준다', () => {
    const s = describeSeverance(FULL_TIME, NOW)
    expect(s.eligible).toBe(true)
    expect(s.qualifyingDate).toBe('2027-09-01')
    expect(s.reason).toContain('30일분')
  })

  it('1년에 못 미치는 계약은 대상이 아니라고 밝힌다', () => {
    const s = describeSeverance({ ...FULL_TIME, contractEndDate: '2027-05-31' }, NOW)
    expect(s.eligible).toBe(false)
    expect(s.reason).toContain('갱신')
  })

  // 9월 1일 시작해 이듬해 8월 31일 끝나면 1년이다. 종료일도 근무일이다.
  it('9월 1일~이듬해 8월 31일 계약은 대상이다', () => {
    expect(describeSeverance({ ...FULL_TIME, contractEndDate: '2027-08-31' }, NOW).eligible).toBe(true)
  })

  it('주 15시간 미만은 대상이 아니다', () => {
    const s = describeSeverance(SHORT_TIME, NOW)
    expect(s.eligible).toBe(false)
    expect(s.reason).toContain('15시간')
  })
})

describe('describeOvertimeRates (제56조)', () => {
  it('통상시급에서 연장·야간·휴일 가산을 계산한다', () => {
    const o = describeOvertimeRates(FULL_TIME)
    expect(o.known).toBe(true)
    // 월 소정근로 약 209시간, 통상임금 290만 → 시급 약 13,881원
    expect(o.hourly).toBeGreaterThan(13000)
    expect(o.hourly).toBeLessThan(15000)
    const extended = o.rates.find((r) => r.name === '연장근로')
    expect(extended.perHour).toBe(Math.round(o.hourly * 1.5))
    const holidayOver = o.rates.find((r) => r.name.includes('8시간 초과'))
    expect(holidayOver.perHour).toBe(Math.round(o.hourly * 2))
  })

  // 통상임금은 소정근로의 대가다. 고정연장수당은 연장의 대가라 통상임금이 아니다.
  it('통상임금에 고정연장수당을 넣지 않는다', () => {
    const terms = {
      ...FULL_TIME,
      wageItems: [
        { name: '기본급', type: 'base', amount: 2000000 },
        { name: '직책수당', type: 'fixed_allowance', amount: 200000 },
        { name: '고정연장수당', type: 'overtime_fixed', amount: 500000 },
      ],
    }
    expect(ordinaryWageBase(terms)).toBe(2200000)
  })

  // 실제보다 높게 잡아 "이만큼 받을 수 있다"고 말하지 않는다.
  it('통상임금 판단이 갈릴 수 있는 항목이 있으면 밝힌다', () => {
    const terms = {
      ...FULL_TIME,
      wageItems: [
        { name: '기본급', type: 'base', amount: 2400000 },
        { name: '식대', type: 'welfare', amount: 200000 },
      ],
    }
    expect(describeOvertimeRates(terms).caveat).toContain('실제 가산수당은 이보다 높아집니다')
  })

  it('임금이나 근로시간을 모르면 계산하지 않는다', () => {
    expect(describeOvertimeRates({ ...FULL_TIME, wageBaseAmount: null }).known).toBe(false)
    expect(describeOvertimeRates({ ...FULL_TIME, workDays: null }).known).toBe(false)
  })
})

describe('describeWorkerRights', () => {
  it('세 가지를 함께 돌려준다', () => {
    const r = describeWorkerRights(FULL_TIME, NOW)
    expect(r.annualLeave.applies).toBe(true)
    expect(r.severance.eligible).toBe(true)
    expect(r.overtime.known).toBe(true)
  })

  it('계약 조건이 없으면 null', () => {
    expect(describeWorkerRights(null, NOW)).toBeNull()
  })
})
