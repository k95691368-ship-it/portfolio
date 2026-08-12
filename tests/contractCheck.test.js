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
  parseBreakMinutes,
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
  // 조문은 "근로시간이 4시간인 경우에는 30분 이상, 8시간인 경우에는 1시간
  // 이상"이다. 초과일 때만으로 읽으면 정각 4시간 무휴게 계약이 통과한다.
  it('4시간·8시간 정각을 포함한다', () => {
    expect(breakMinutesFor(9 * 60)).toBe(60)
    expect(breakMinutesFor(8 * 60)).toBe(60)
    expect(breakMinutesFor(6 * 60)).toBe(30)
    expect(breakMinutesFor(4 * 60)).toBe(30)
    expect(breakMinutesFor(4 * 60 - 1)).toBe(0)
  })
})

describe('computeWeeklyHours', () => {
  it('computes a standard 9-to-6, 5-day week as 40 hours', () => {
    expect(
      computeWeeklyHours({ workHoursStart: '09:00', workHoursEnd: '18:00', workDays: '주 5일 (월~금)' })
    ).toBe(40)
  })
  it('handles overnight shifts', () => {
    // 22:00~06:00 = 8시간 span. 근로시간 8시간이면 제54조상 1시간 휴게이므로
    // 7h × 5 = 35. 예전에는 '8시간 초과'로만 읽어 30분을 뺐다.
    expect(
      computeWeeklyHours({ workHoursStart: '22:00', workHoursEnd: '06:00', workDays: '주 5일' })
    ).toBe(35)
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
    // 9시간 근무에는 제54조상 1시간 휴게가 필요하다. 적법한 계약이라면
    // 이 값도 함께 있어야 한다 — 없으면 그것부터 문제다.
    breakTime: '12:00~13:00',
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
      workHoursEnd: '18:00', workDays: '주 5일 (월~금)', restDays: '토, 일',
      wageBaseAmount: 2800000,
      wagePayMethod: '계좌이체', wagePayDate: '매월 10일', annualLeave: '근로기준법에 따름',
    }
    expect(findMissingFields(complete)).toEqual([])
  })

  // 근무일이 비면 주 소정근로시간이 정해지지 않는다. 제17조 제1항 제2호가
  // 명시하라는 것은 시각이 아니라 '소정근로시간'이다. 게다가 이 값이 없으면
  // 최저임금·주52시간·연차·퇴직금 판정이 전부 조용히 생략되어, 경고 0건으로
  // 최저임금 미달 계약이 서명될 수 있었다.
  it('근무일이 비면 누락으로 잡는다', () => {
    const withoutDays = {
      employerName: 'A', employeeName: 'B', contractStartDate: '2026-09-01',
      workLocation: '서울', jobDescription: '운영', workHoursStart: '09:00',
      workHoursEnd: '18:00', restDays: '토, 일', wageBaseAmount: 1000000,
      wagePayMethod: '계좌이체', wagePayDate: '매월 10일', annualLeave: '근로기준법에 따름',
    }
    expect(findMissingFields(withoutDays).map((m) => m.field)).toContain('workDays')
  })

  // 근로기준법 제17조 제1항이 직접 열거하는 항목인데 목록에서 빠져 있었다.
  // 이 셋이 비어 있어도 "필수 항목 누락"으로 잡히지 않아, 서면 명시 위반
  // (제114조 벌금 대상) 상태로 서명이 가능했다.
  it('휴일·연차·임금 지급방법도 필수로 본다', () => {
    const withoutThree = {
      employerName: 'A', employeeName: 'B', contractStartDate: '2026-09-01',
      workLocation: '서울', jobDescription: '운영', workHoursStart: '09:00',
      workHoursEnd: '18:00', wageBaseAmount: 2800000, wagePayDate: '매월 10일',
    }
    const fields = findMissingFields(withoutThree).map((m) => m.field)
    expect(fields).toContain('restDays')
    expect(fields).toContain('annualLeave')
    expect(fields).toContain('wagePayMethod')
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

// 계약서 인쇄본의 소정근로시간 줄은 괄호 안이 상수로 박힌 빈칸이었다.
// 입력란도 저장할 칸도 없어 채울 방법 자체가 없었다.
//
// 휴게시간은 적어도 되는 항목이 아니다 — 제54조가 길이를 정하고, 제17조
// 제1항 제5호·시행령 제8조 제2호(제93조 제1호)가 명시를 요구한다.
describe('휴게시간 (근로기준법 제54조)', () => {
  const base = {
    employerName: 'A', employeeName: 'B', contractStartDate: '2026-09-01',
    workLocation: '서울', jobDescription: '사무',
    workHoursStart: '09:00', workHoursEnd: '18:00', workDays: '주 5일',
    restDays: '토, 일', wageType: 'monthly', wageBaseAmount: 3000000,
    wagePayMethod: '계좌이체', wagePayDate: '매월 10일', annualLeave: '법에 따름',
    employeeCount: 10,
  }
  const find = (terms, title) => checkLegalCompliance(terms).find((i) => i.title === title)

  it('구간으로 적은 휴게시간을 분으로 읽는다', () => {
    expect(parseBreakMinutes('12:00~13:00')).toBe(60)
    expect(parseBreakMinutes('12시 ~ 12시 30분')).toBe(30)
    expect(parseBreakMinutes('12:00-13:00')).toBe(60)
  })

  // 휴게를 나눠 주는 것은 제54조가 막지 않는다. 첫 구간만 읽으면 합계 60분이
  // 30분으로 보여, 법을 지킨 계약에 형사처벌 문구가 붙은 경고가 뜬다.
  it('나눠 적은 휴게를 모두 더한다', () => {
    expect(parseBreakMinutes('12:00~12:30, 18:00~18:30')).toBe(60)
    expect(parseBreakMinutes('점심 12:00~13:00, 저녁 18:00~19:00')).toBe(120)
  })

  it('분까지 적은 구간도 절반으로 읽지 않는다', () => {
    expect(parseBreakMinutes('12시30분~13시30분')).toBe(60)
    expect(parseBreakMinutes('12시 30분부터 13시 30분까지')).toBe(60)
  })

  // 오전·오후가 캡처 밖으로 잘리면 12시→1시가 거꾸로 읽혀 통째로 버려진다.
  it('오전·오후를 붙여 적어도 읽는다', () => {
    expect(parseBreakMinutes('오후 12시~오후 1시')).toBe(60)
    expect(parseBreakMinutes('12시~1시')).toBe(60)
  })

  // 법 문구를 그대로 옮겨 적는 것이 가장 흔한 입력이다. 아무 숫자나 잡으면
  // '휴게 480분'이 되어 제54조 검사가 통째로 꺼진다.
  it('근무를 가리키는 말이 섞이면 읽지 않는다 — 480분으로 잘못 아느니 모르는 편이 낫다', () => {
    expect(parseBreakMinutes('8시간 근무 시 1시간')).toBeNull()
    expect(parseBreakMinutes('1일 8시간 기준 1시간')).toBeNull()
    expect(parseBreakMinutes('4시간마다 30분')).toBeNull()
    expect(parseBreakMinutes('09:00~18:00')).toBeNull()
  })

  it('길이로 적어도 읽는다 — 사람이 실제로 쓰는 방식이 둘 다다', () => {
    expect(parseBreakMinutes('1시간')).toBe(60)
    expect(parseBreakMinutes('30분')).toBe(30)
    expect(parseBreakMinutes('1시간 30분')).toBe(90)
  })

  // "12:00~13:00" 을 '12시간 00분'으로 읽으면 720분이 되어, 부족한 휴게가
  // 넉넉한 것으로 통과한다.
  it('구간을 길이로 오해하지 않는다', () => {
    expect(parseBreakMinutes('12:00~13:00')).not.toBe(720)
  })

  it('읽을 수 없으면 모르는 것으로 둔다', () => {
    expect(parseBreakMinutes('')).toBeNull()
    expect(parseBreakMinutes(null)).toBeNull()
    expect(parseBreakMinutes('점심시간 있음')).toBeNull()
  })

  it('9시간 근무에 휴게가 없으면 알린다', () => {
    const issue = find(base, '휴게시간 미기재')
    expect(issue).toBeTruthy()
    expect(issue.detail).toContain('60분')
  })

  it('9시간 근무에 30분만 주면 위반이다', () => {
    const issue = find({ ...base, breakTime: '12:00~12:30' }, '휴게시간 부족')
    expect(issue?.severity).toBe('high')
  })

  it('법정 시간을 채우면 아무 말도 하지 않는다', () => {
    const issues = checkLegalCompliance({ ...base, breakTime: '12:00~13:00' })
    expect(issues.some((i) => i.title.includes('휴게시간'))).toBe(false)
  })

  // 4시간 이하 근무에는 휴게 의무가 없다. 없는 위반을 만들면 진짜 경고까지
  // 함께 무시된다.
  it('4시간에 못 미치는 근무에는 휴게를 요구하지 않는다', () => {
    // 09:00~13:00 은 정각 4시간이라 제54조 대상이다. 그보다 짧아야 면제된다.
    const short = { ...base, workHoursStart: '09:00', workHoursEnd: '12:00' }
    expect(checkLegalCompliance(short).some((i) => i.title.includes('휴게시간'))).toBe(false)
  })

  it('근무 시각을 모르면 판단하지 않는다', () => {
    const unknown = { ...base, workHoursStart: '', workHoursEnd: '' }
    expect(checkLegalCompliance(unknown).some((i) => i.title.includes('휴게시간'))).toBe(false)
  })
})


// 계약서에 적힌 휴게시간을 계산에 쓰지 않고 언제나 '법정 최소'만 빼고 있었다.
// 휴게를 법보다 길게 주기로 한 계약이 실제보다 오래 일하는 것으로 읽힌다.
describe('휴게시간이 근로시간 계산에 반영된다', () => {
  const span12 = { workHoursStart: '09:00', workHoursEnd: '21:00', workDays: '주 5일' }

  it('적힌 휴게를 뺀다', () => {
    expect(computeWeeklyHours({ ...span12, breakTime: '15:00~17:00' })).toBe(50)
  })

  it('적히지 않았으면 법정 최소를 뺀다 — 모른다고 0으로 두면 과대 계산된다', () => {
    expect(computeWeeklyHours(span12)).toBe(55)
  })

  // 12시간 구간에 휴게 2시간이면 실제 주 50시간이다. 55시간으로 읽으면
  // 적법한 계약에 '주 52시간 초과'가 high 로 뜨고 서명이 막힌다.
  it('휴게가 넉넉한 계약에 없는 위반을 만들지 않는다', () => {
    const lawful = {
      ...span12,
      breakTime: '15:00~17:00',
      employeeCount: 10,
      wageType: 'monthly',
      wageBaseAmount: 3000000,
    }
    expect(checkLegalCompliance(lawful).some((i) => i.title === '주 52시간 초과')).toBe(false)
  })
})

// 제54조는 "근로시간이 4시간인 경우"라고 쓴다. 초과일 때만 요구하면 정각
// 4시간 무휴게 계약이 경고 한 건 없이 통과한다.
describe('제54조의 경계는 포함이다', () => {
  it('정각 4시간·8시간도 휴게 대상이다', () => {
    expect(breakMinutesFor(4 * 60)).toBe(30)
    expect(breakMinutesFor(8 * 60)).toBe(60)
    expect(breakMinutesFor(4 * 60 - 1)).toBe(0)
  })

  it('09:00~13:00 무휴게 계약을 잡는다', () => {
    const four = { workHoursStart: '09:00', workHoursEnd: '13:00', workDays: '주 5일' }
    expect(checkLegalCompliance(four).some((i) => i.title === '휴게시간 미기재')).toBe(true)
  })
})
