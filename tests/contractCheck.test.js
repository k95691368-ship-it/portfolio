import { describe, expect, it } from 'vitest'
import {
  parseTimeToMinutes,
  parseDaysPerWeek,
  breakMinutesFor,
  computeWeeklyHours,
  monthlyPaidHours,
  checkLegalCompliance,
  findMissingFields,
  diffAgreedVsCurrent,
  normalizeForCompare,
  MINIMUM_HOURLY_WAGE_2026,
} from '../functions/_lib/contractCheck.js'

describe('parseTimeToMinutes', () => {
  it('parses common time formats', () => {
    expect(parseTimeToMinutes('09:00')).toBe(540)
    expect(parseTimeToMinutes('9:30')).toBe(570)
    expect(parseTimeToMinutes('18시')).toBe(1080)
  })
  it('returns null for invalid input', () => {
    expect(parseTimeToMinutes('오전')).toBeNull()
    expect(parseTimeToMinutes(null)).toBeNull()
    expect(parseTimeToMinutes('99:99')).toBeNull()
  })
})

describe('parseDaysPerWeek', () => {
  it('parses explicit week counts', () => {
    expect(parseDaysPerWeek('주 5일')).toBe(5)
    expect(parseDaysPerWeek('주5일 (월~금)')).toBe(5)
    expect(parseDaysPerWeek('주 6일')).toBe(6)
  })
  it('parses weekday ranges', () => {
    expect(parseDaysPerWeek('월~금')).toBe(5)
    expect(parseDaysPerWeek('월~토')).toBe(6)
  })
  it('returns null when unknown', () => {
    expect(parseDaysPerWeek('협의')).toBeNull()
    expect(parseDaysPerWeek(null)).toBeNull()
  })
})

describe('breakMinutesFor (근로기준법 제54조)', () => {
  it('gives 1 hour over 8 hours, 30 min over 4 hours', () => {
    expect(breakMinutesFor(9 * 60)).toBe(60)
    expect(breakMinutesFor(6 * 60)).toBe(30)
    expect(breakMinutesFor(4 * 60)).toBe(0)
  })
})

describe('computeWeeklyHours', () => {
  it('computes a standard 9-to-6, 5-day week as 40 hours', () => {
    expect(
      computeWeeklyHours({ workHoursStart: '09:00', workHoursEnd: '18:00', workDays: '주 5일 (월~금)' })
    ).toBe(40)
  })
  it('handles overnight shifts', () => {
    // 22:00~06:00 = 8시간 span → 30분 휴게 → 7.5h × 5 = 37.5
    expect(
      computeWeeklyHours({ workHoursStart: '22:00', workHoursEnd: '06:00', workDays: '주 5일' })
    ).toBe(37.5)
  })
  it('returns null when information is incomplete', () => {
    expect(computeWeeklyHours({ workHoursStart: '09:00', workHoursEnd: null, workDays: '주 5일' })).toBeNull()
    expect(computeWeeklyHours({ workHoursStart: '09:00', workHoursEnd: '18:00', workDays: '협의' })).toBeNull()
  })
})

describe('monthlyPaidHours', () => {
  it('matches the standard 209 hours for a 40-hour week', () => {
    expect(Math.round(monthlyPaidHours(40))).toBe(209)
  })
  it('excludes weekly holiday pay under 15 hours', () => {
    expect(Math.round(monthlyPaidHours(10))).toBe(43)
  })
})

describe('checkLegalCompliance', () => {
  const lawful = {
    workHoursStart: '09:00',
    workHoursEnd: '18:00',
    workDays: '주 5일 (월~금)',
    wageBaseAmount: 2800000,
  }

  it('reports no issues for a lawful contract', () => {
    expect(checkLegalCompliance(lawful)).toEqual([])
  })

  it('flags wages below the 2026 minimum', () => {
    const issues = checkLegalCompliance({ ...lawful, wageBaseAmount: 1800000 })
    expect(issues.some((i) => i.title.includes('최저임금') && i.severity === 'high')).toBe(true)
  })

  it('suggests the lawful minimum wage so it can be requested directly', () => {
    const issues = checkLegalCompliance({ ...lawful, wageBaseAmount: 1800000 })
    const wageIssue = issues.find((i) => i.title.includes('최저임금'))
    expect(wageIssue.field).toBe('wageBaseAmount')
    // 주 40시간 → 월 209시간 × 10,320원 ≈ 2,156,880원
    const suggested = Number(wageIssue.suggestedValue)
    expect(suggested).toBeGreaterThan(2150000)
    expect(suggested).toBeLessThan(2160000)
    // 제안값을 그대로 넣으면 더 이상 위반이 아니어야 한다.
    const fixed = checkLegalCompliance({ ...lawful, wageBaseAmount: suggested })
    expect(fixed.some((i) => i.title.includes('최저임금'))).toBe(false)
  })

  it('accepts a wage exactly at the minimum', () => {
    const atMinimum = Math.ceil(MINIMUM_HOURLY_WAGE_2026 * 209)
    const issues = checkLegalCompliance({ ...lawful, wageBaseAmount: atMinimum })
    expect(issues.some((i) => i.title.includes('최저임금'))).toBe(false)
  })

  it('flags weeks beyond the 52-hour ceiling', () => {
    // 09:00~22:00 (13h span → 12h) × 5 = 60h
    const issues = checkLegalCompliance({
      workHoursStart: '09:00',
      workHoursEnd: '22:00',
      workDays: '주 5일',
      wageBaseAmount: 5000000,
    })
    expect(issues.some((i) => i.title.includes('52시간') && i.severity === 'high')).toBe(true)
  })

  it('notes overtime between 40 and 52 hours without treating it as a violation', () => {
    // 09:00~19:00 (10h span → 9h) × 5 = 45h
    const issues = checkLegalCompliance({
      workHoursStart: '09:00',
      workHoursEnd: '19:00',
      workDays: '주 5일',
      wageBaseAmount: 3500000,
    })
    const overtime = issues.find((i) => i.title.includes('연장근로'))
    expect(overtime?.severity).toBe('info')
  })

  it('flags social insurance explicitly turned off', () => {
    const issues = checkLegalCompliance({ ...lawful, socialInsurance: { national_pension: false } })
    expect(issues.some((i) => i.title.includes('사회보험'))).toBe(true)
  })

  it('stays silent when data is insufficient', () => {
    expect(checkLegalCompliance({ wageBaseAmount: 100 })).toEqual([])
  })
})

describe('findMissingFields', () => {
  it('lists required fields that are empty', () => {
    const missing = findMissingFields({ employerName: '회사', wageBaseAmount: 2800000 })
    const fields = missing.map((m) => m.field)
    expect(fields).toContain('employeeName')
    expect(fields).toContain('contractStartDate')
    expect(fields).not.toContain('employerName')
  })
  it('returns empty when everything required is present', () => {
    const complete = {
      employerName: 'A', employeeName: 'B', contractStartDate: '2026-09-01',
      workLocation: '서울', jobDescription: '운영', workHoursStart: '09:00',
      workHoursEnd: '18:00', wageBaseAmount: 2800000, wagePayDate: '매월 10일',
    }
    expect(findMissingFields(complete)).toEqual([])
  })
})

describe('normalizeForCompare', () => {
  it('treats Korean and ISO dates as the same value', () => {
    expect(normalizeForCompare('2026년 9월 1일')).toBe('2026-09-01')
    expect(normalizeForCompare('2026-09-01')).toBe('2026-09-01')
    expect(normalizeForCompare('2026.9.1')).toBe('2026-09-01')
    expect(normalizeForCompare('2026/09/01')).toBe('2026-09-01')
  })
  it('treats spoken and clock times as the same value', () => {
    expect(normalizeForCompare('9시')).toBe('09:00')
    expect(normalizeForCompare('09:00')).toBe('09:00')
    expect(normalizeForCompare('9:00')).toBe('09:00')
  })
  it('treats formatted and raw amounts as the same value', () => {
    expect(normalizeForCompare('3,200,000')).toBe('3200000')
    expect(normalizeForCompare(3200000)).toBe('3200000')
    expect(normalizeForCompare('3200000원')).toBe('3200000')
  })
  it('collapses incidental whitespace', () => {
    expect(normalizeForCompare('  서울   본사 ')).toBe('서울 본사')
  })
  it('maps empty-ish values to an empty string', () => {
    expect(normalizeForCompare(null)).toBe('')
    expect(normalizeForCompare('   ')).toBe('')
  })
})

describe('diffAgreedVsCurrent', () => {
  it('does not flag a date that only changed notation', () => {
    // AI는 "2026년 9월 1일"로 추출하고 폼은 "2026-09-01"로 저장한다 — 같은 날짜다.
    const history = [{ changes: [{ field: 'contractStartDate', from: '2026년 9월 1일', to: '2026-09-01' }] }]
    expect(diffAgreedVsCurrent(history, { contractStartDate: '2026-09-01' })).toEqual([])
  })

  it('does not flag an amount that only changed formatting', () => {
    const history = [{ changes: [{ field: 'wageBaseAmount', from: '3,200,000', to: 3200000 }] }]
    expect(diffAgreedVsCurrent(history, { wageBaseAmount: 3200000 })).toEqual([])
  })

  it('still flags a genuine date change', () => {
    const history = [{ changes: [{ field: 'contractStartDate', from: '2026년 9월 1일', to: '2026-12-01' }] }]
    const diffs = diffAgreedVsCurrent(history, { contractStartDate: '2026-12-01' })
    expect(diffs).toHaveLength(1)
    expect(diffs[0].label).toBe('근로개시일')
  })

  it('detects a wage lowered after the chat agreement', () => {
    const history = [{ changes: [{ field: 'wageBaseAmount', from: 2800000, to: 2000000 }] }]
    const diffs = diffAgreedVsCurrent(history, { wageBaseAmount: 2000000 })
    expect(diffs).toHaveLength(1)
    expect(diffs[0].label).toBe('기본급')
    expect(diffs[0].agreed).toBe('2,800,000')
    expect(diffs[0].current).toBe('2,000,000')
  })

  it('uses the earliest recorded value as the agreed one', () => {
    const history = [
      { changes: [{ field: 'workLocation', from: '서울 본사', to: '부산 지사' }] },
      { changes: [{ field: 'workLocation', from: '부산 지사', to: '대구 지사' }] },
    ]
    const diffs = diffAgreedVsCurrent(history, { workLocation: '대구 지사' })
    expect(diffs[0].agreed).toBe('서울 본사')
    expect(diffs[0].current).toBe('대구 지사')
  })

  it('ignores fields restored to the agreed value', () => {
    const history = [
      { changes: [{ field: 'workLocation', from: '서울 본사', to: '부산 지사' }] },
      { changes: [{ field: 'workLocation', from: '부산 지사', to: '서울 본사' }] },
    ]
    expect(diffAgreedVsCurrent(history, { workLocation: '서울 본사' })).toEqual([])
  })

  it('does not flag filling in a previously empty field', () => {
    const history = [{ changes: [{ field: 'employerAddress', from: null, to: '서울시 강남구' }] }]
    expect(diffAgreedVsCurrent(history, { employerAddress: '서울시 강남구' })).toEqual([])
  })

  it('does not flag a change the candidate requested and the company accepted', () => {
    // 지원자가 요청해 회사가 수락한 값은 양측 합의이므로 불일치가 아니다.
    const history = [
      { source: 'manual', changes: [{ field: 'wageBaseAmount', from: 3000000, to: 1700000 }] },
      { source: 'change_request', changes: [{ field: 'wageBaseAmount', from: 1700000, to: 2152460 }] },
    ]
    expect(diffAgreedVsCurrent(history, { wageBaseAmount: 2152460 })).toEqual([])
  })

  it('flags a unilateral change made after an agreed one', () => {
    const history = [
      { source: 'change_request', changes: [{ field: 'wageBaseAmount', from: 1700000, to: 2200000 }] },
      { source: 'manual', changes: [{ field: 'wageBaseAmount', from: 2200000, to: 1900000 }] },
    ]
    const diffs = diffAgreedVsCurrent(history, { wageBaseAmount: 1900000 })
    expect(diffs).toHaveLength(1)
    expect(diffs[0].agreed).toBe('2,200,000')
    expect(diffs[0].current).toBe('1,900,000')
  })

  it('returns empty when there is no edit history', () => {
    expect(diffAgreedVsCurrent([], { wageBaseAmount: 2800000 })).toEqual([])
  })
})

// 반증 검증에서 확인된 파싱 결함의 회귀 방지.
// 이 두 함수는 최저임금·주52시간 판정의 입력이라, 여기서 어긋나면 적법한
// 계약에 허위 위법 경고가 나가고 진짜 미달 계약이 통과한다.
describe('parseTimeToMinutes — 오전/오후 표기', () => {
  it('오후는 12시간을 더한다', () => {
    expect(parseTimeToMinutes('오후 6시')).toBe(18 * 60)
    expect(parseTimeToMinutes('오후 6시 30분')).toBe(18 * 60 + 30)
  })

  it('오전 12시는 자정, 오후 12시는 정오', () => {
    expect(parseTimeToMinutes('오전 12시')).toBe(0)
    expect(parseTimeToMinutes('오후 12시')).toBe(12 * 60)
  })

  it('오전 표기는 그대로 읽는다', () => {
    expect(parseTimeToMinutes('오전 9시')).toBe(9 * 60)
  })

  it('24시간제 표기는 영향을 받지 않는다', () => {
    expect(parseTimeToMinutes('18:00')).toBe(18 * 60)
    expect(parseTimeToMinutes('09:00')).toBe(9 * 60)
    expect(parseTimeToMinutes('9시')).toBe(9 * 60)
  })

  it('오전 9시 ~ 오후 6시는 주 40시간으로 계산된다', () => {
    const weekly = computeWeeklyHours({
      workHoursStart: '오전 9시',
      workHoursEnd: '오후 6시',
      workDays: '주 5일 (월~금)',
    })
    expect(weekly).toBe(40)
  })
})

describe('parseDaysPerWeek — "요일"을 붙여 쓴 표기', () => {
  it('월요일~금요일은 5일이다', () => {
    expect(parseDaysPerWeek('월요일~금요일')).toBe(5)
    expect(parseDaysPerWeek('화요일~토요일')).toBe(5)
  })

  it('토요일~일요일은 2일이다', () => {
    expect(parseDaysPerWeek('토요일~일요일')).toBe(2)
  })

  it('월요일~토요일은 6일이다', () => {
    expect(parseDaysPerWeek('월요일~토요일')).toBe(6)
  })

  it('나열 표기도 요일을 붙여도 센다', () => {
    expect(parseDaysPerWeek('토요일, 일요일')).toBe(2)
  })

  it('기존 축약 표기는 그대로 동작한다', () => {
    expect(parseDaysPerWeek('월~금')).toBe(5)
    expect(parseDaysPerWeek('월~토')).toBe(6)
    expect(parseDaysPerWeek('주 5일 (월~금)')).toBe(5)
  })

  it('주말만 일하는 계약의 최저임금 미달을 잡아낸다', () => {
    // 토·일 각 12시간 = 주 24시간. 이전에는 주 1일 12시간으로 읽혀 통과했다.
    const issues = checkLegalCompliance({
      workHoursStart: '09:00',
      workHoursEnd: '22:00',
      workDays: '토요일~일요일',
      wageBaseAmount: 1100000,
    })
    expect(issues.some((i) => i.title.includes('최저임금'))).toBe(true)
  })

  it('적법한 월요일~금요일 계약에는 허위 경고를 내지 않는다', () => {
    const issues = checkLegalCompliance({
      workHoursStart: '09:00',
      workHoursEnd: '18:00',
      workDays: '월요일~금요일',
      wageBaseAmount: 2200000,
    })
    expect(issues.some((i) => i.title.includes('최저임금'))).toBe(false)
    expect(issues.some((i) => i.title.includes('52시간'))).toBe(false)
  })
})
