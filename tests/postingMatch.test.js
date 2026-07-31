import { describe, it, expect } from 'vitest'
import {
  comparePostingToContract,
  postingWageToMonthly,
  wageTypeLabel,
} from '../functions/_lib/postingMatch.js'

const POSTING = {
  wageType: 'monthly',
  wageMin: 2500000,
  wageMax: 3000000,
  workHoursStart: '09:00',
  workHoursEnd: '18:00',
  workDays: '주 5일 (월~금)',
  employmentType: '정규직',
  location: '서울 본사',
}

const TERMS = {
  wageBaseAmount: 2600000,
  workHoursStart: '09:00',
  workHoursEnd: '18:00',
  workDays: '주 5일 (월~금)',
  workLocation: '서울 본사',
  contractEndDate: null,
}

const find = (r, field) => r.issues.find((i) => i.field === field)

describe('wageTypeLabel', () => {
  it('임금 종류를 한국어로 옮긴다', () => {
    expect(wageTypeLabel('monthly')).toBe('월급')
    expect(wageTypeLabel('hourly')).toBe('시급')
    expect(wageTypeLabel('annual')).toBe('연봉')
  })
})

describe('postingWageToMonthly', () => {
  it('월급은 그대로 쓴다', () => {
    expect(postingWageToMonthly(POSTING, TERMS).monthly).toBe(2500000)
  })

  it('연봉은 12로 나눈다', () => {
    const r = postingWageToMonthly({ ...POSTING, wageType: 'annual', wageMin: 36000000 }, TERMS)
    expect(r.monthly).toBe(3000000)
    expect(r.basis).toContain('12개월')
  })

  it('시급은 계약서의 근로시간으로 환산한다', () => {
    const r = postingWageToMonthly({ ...POSTING, wageType: 'hourly', wageMin: 11000 }, TERMS)
    // 주 40시간 → 월 소정근로 약 209시간
    expect(r.monthly).toBeGreaterThan(11000 * 200)
    expect(r.basis).toContain('시급 하한')
  })

  it('시급인데 근로시간을 모르면 환산하지 않는다', () => {
    expect(postingWageToMonthly({ ...POSTING, wageType: 'hourly', wageMin: 11000 }, {})).toBeNull()
  })

  it('임금이 없으면 null', () => {
    expect(postingWageToMonthly({ ...POSTING, wageMin: null }, TERMS)).toBeNull()
    expect(postingWageToMonthly(null, TERMS)).toBeNull()
  })
})

describe('comparePostingToContract — 임금', () => {
  it('공고 하한 이상이면 문제없다', () => {
    const r = comparePostingToContract(POSTING, TERMS)
    expect(r.issues).toHaveLength(0)
    expect(r.hasUnfavorable).toBe(false)
    expect(r.summary).toContain('어긋나지 않습니다')
  })

  it('공고보다 적으면 얼마나 적은지 알려준다', () => {
    const r = comparePostingToContract(POSTING, { ...TERMS, wageBaseAmount: 2200000 })
    const wage = find(r, 'wageBaseAmount')
    expect(wage.severity).toBe('high')
    expect(wage.message).toContain('300,000원 적습니다')
    expect(r.hasUnfavorable).toBe(true)
    expect(r.summary).toContain('제4조 제3항')
  })

  it('연봉으로 제시한 공고도 견준다', () => {
    const r = comparePostingToContract(
      { ...POSTING, wageType: 'annual', wageMin: 36000000 },
      { ...TERMS, wageBaseAmount: 2500000 }
    )
    expect(find(r, 'wageBaseAmount').severity).toBe('high')
  })
})

describe('comparePostingToContract — 근로시간과 근무일', () => {
  it('근로시간이 늘면 불리한 변경으로 본다', () => {
    const r = comparePostingToContract(POSTING, { ...TERMS, workHoursEnd: '20:00' })
    const h = find(r, 'workHours')
    expect(h.severity).toBe('high')
    expect(h.message).toContain('늘었습니다')
  })

  it('근로시간이 줄면 문제로 보지 않는다', () => {
    const r = comparePostingToContract(POSTING, { ...TERMS, workHoursEnd: '17:00' })
    expect(find(r, 'workHours')).toBeUndefined()
  })

  it('근무일이 늘면 알린다', () => {
    const r = comparePostingToContract(POSTING, {
      ...TERMS,
      workDays: '주 6일 (월~토)',
      workHoursEnd: '18:00',
    })
    expect(find(r, 'workDays').severity).toBe('medium')
  })
})

describe('comparePostingToContract — 고용형태', () => {
  it('정규직 공고인데 기간제 계약이면 불리한 변경이다', () => {
    const r = comparePostingToContract(POSTING, { ...TERMS, contractEndDate: '2027-08-31' })
    const t = find(r, 'employmentType')
    expect(t.severity).toBe('high')
    expect(t.message).toContain('기간제')
  })

  it('계약직 공고에는 종료일이 있어도 문제로 보지 않는다', () => {
    const r = comparePostingToContract(
      { ...POSTING, employmentType: '계약직' },
      { ...TERMS, contractEndDate: '2027-08-31' }
    )
    expect(find(r, 'employmentType')).toBeUndefined()
  })
})

describe('comparePostingToContract — 근무지', () => {
  it('근무지가 다르면 확인하라고 알린다', () => {
    const r = comparePostingToContract(POSTING, { ...TERMS, workLocation: '부산 지점' })
    const loc = find(r, 'workLocation')
    expect(loc.severity).toBe('medium')
    expect(loc.message).toContain('출퇴근')
  })

  it('한쪽이 다른 쪽을 포함하면 같은 곳으로 본다', () => {
    const r = comparePostingToContract(POSTING, { ...TERMS, workLocation: '서울 본사 3층' })
    expect(find(r, 'workLocation')).toBeUndefined()
  })
})

describe('comparePostingToContract — 비교할 수 없을 때', () => {
  it('공고에 구조화된 조건이 없으면 그렇게 말한다', () => {
    const r = comparePostingToContract({ location: '' }, TERMS)
    expect(r.comparable).toBe(false)
    expect(r.summary).toContain('대조할 수 없습니다')
  })

  it('값이 없어도 무너지지 않는다', () => {
    expect(comparePostingToContract(null, null).comparable).toBe(false)
    expect(comparePostingToContract(POSTING, null).issues).toEqual([])
  })
})
