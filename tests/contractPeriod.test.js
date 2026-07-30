import { describe, expect, it } from 'vitest'
import {
  parseContractDate,
  monthsBetween,
  describeContractPeriod,
  checkPeriodCompliance,
  describeContinuousEmployment,
  checkContinuityCompliance,
  describeRetention,
} from '../functions/_lib/contractPeriod.js'

const NOW = new Date(Date.UTC(2026, 8, 15)) // 2026-09-15 기준으로 고정

describe('parseContractDate', () => {
  it('여러 표기를 같은 날짜로 읽는다', () => {
    const iso = parseContractDate('2026-09-01').toISOString().slice(0, 10)
    expect(parseContractDate('2026년 9월 1일').toISOString().slice(0, 10)).toBe(iso)
    expect(parseContractDate('2026.9.1').toISOString().slice(0, 10)).toBe(iso)
    expect(parseContractDate('2026/09/01').toISOString().slice(0, 10)).toBe(iso)
  })
  it('알 수 없는 값은 null', () => {
    expect(parseContractDate('추후 협의')).toBeNull()
    expect(parseContractDate(null)).toBeNull()
    expect(parseContractDate('2026-02-30')).toBeNull()
  })
})

describe('monthsBetween', () => {
  it('달력 기준으로 개월을 센다', () => {
    expect(monthsBetween(parseContractDate('2026-01-01'), parseContractDate('2027-01-01'))).toBe(12)
    expect(monthsBetween(parseContractDate('2026-01-01'), parseContractDate('2028-01-01'))).toBe(24)
    expect(monthsBetween(parseContractDate('2026-01-01'), parseContractDate('2028-01-31'))).toBe(24)
  })
  it('한 달이 덜 찼으면 세지 않는다', () => {
    expect(monthsBetween(parseContractDate('2026-01-15'), parseContractDate('2026-02-14'))).toBe(0)
  })
})

describe('describeContractPeriod', () => {
  it('종료일이 없으면 기간의 정함이 없는 계약으로 본다', () => {
    const p = describeContractPeriod({ contractStartDate: '2026-01-01' }, NOW)
    expect(p.openEnded).toBe(true)
    expect(p.status).toBe('open_ended')
  })

  it('날짜가 없으면 알 수 없음으로 둔다', () => {
    expect(describeContractPeriod({}, NOW).known).toBe(false)
    expect(describeContractPeriod({ contractStartDate: '추후 협의' }, NOW).known).toBe(false)
  })

  it('아직 시작 전이면 개시 예정', () => {
    const p = describeContractPeriod(
      { contractStartDate: '2026-10-01', contractEndDate: '2027-09-30' },
      NOW
    )
    expect(p.status).toBe('scheduled')
  })

  it('진행 중인 계약', () => {
    const p = describeContractPeriod(
      { contractStartDate: '2026-01-01', contractEndDate: '2026-12-31' },
      NOW
    )
    expect(p.status).toBe('active')
    expect(p.remainingDays).toBeGreaterThan(30)
  })

  it('30일 이내면 만료 임박으로 알린다', () => {
    const p = describeContractPeriod(
      { contractStartDate: '2026-01-01', contractEndDate: '2026-10-01' },
      NOW
    )
    expect(p.status).toBe('expiring_soon')
    expect(p.remainingDays).toBe(16)
    expect(p.label).toContain('16일')
  })

  it('지난 계약은 만료로 표시한다', () => {
    const p = describeContractPeriod(
      { contractStartDate: '2025-01-01', contractEndDate: '2026-08-31' },
      NOW
    )
    expect(p.status).toBe('expired')
    expect(p.remainingDays).toBeLessThan(0)
  })

  // 기간제법 제4조의 "2년을 초과"는 일 단위 기준이다. 개월 내림으로 판정하면
  // 2년 하루부터 2년 한 달까지가 사각지대로 남아 경고가 아예 나가지 않는다.
  it('꼭 2년까지는 초과가 아니다', () => {
    const exactly = describeContractPeriod(
      // 2026-01-01 ~ 2027-12-31 = 종료일 포함 정확히 2년
      { contractStartDate: '2026-01-01', contractEndDate: '2027-12-31' },
      NOW
    )
    expect(exactly.exceedsFixedTermLimit).toBe(false)
  })

  it('2년을 하루라도 넘기면 초과로 잡는다', () => {
    const oneDayOver = describeContractPeriod(
      // 종료일까지 근무하므로 이 계약은 2년 + 1일이다
      { contractStartDate: '2026-01-01', contractEndDate: '2028-01-01' },
      NOW
    )
    // 개월 라벨은 여전히 24개월로 보여 주되, 판정은 초과다
    expect(oneDayOver.months).toBe(24)
    expect(oneDayOver.exceedsFixedTermLimit).toBe(true)
  })

  it('개월로는 24라서 놓쳤던 구간을 잡는다', () => {
    // 2년 31일 — 이전에는 months=24로 계산돼 경고가 없었다
    const gap = describeContractPeriod(
      { contractStartDate: '2026-01-01', contractEndDate: '2028-01-31' },
      NOW
    )
    expect(gap.months).toBe(24)
    expect(gap.exceedsFixedTermLimit).toBe(true)

    const clearlyOver = describeContractPeriod(
      { contractStartDate: '2026-01-01', contractEndDate: '2028-03-01' },
      NOW
    )
    expect(clearlyOver.exceedsFixedTermLimit).toBe(true)
  })

  it('월말 시작 계약도 같은 기준으로 본다', () => {
    // 2026-01-31 ~ 2028-01-30 = 정확히 2년
    expect(
      describeContractPeriod(
        { contractStartDate: '2026-01-31', contractEndDate: '2028-01-30' },
        NOW
      ).exceedsFixedTermLimit
    ).toBe(false)
    // 하루 더
    expect(
      describeContractPeriod(
        { contractStartDate: '2026-01-31', contractEndDate: '2028-01-31' },
        NOW
      ).exceedsFixedTermLimit
    ).toBe(true)
  })
})

describe('checkPeriodCompliance (기간제법 제4조)', () => {
  it('정상 기간에는 경고하지 않는다', () => {
    expect(
      checkPeriodCompliance({ contractStartDate: '2026-01-01', contractEndDate: '2027-01-01' }, NOW)
    ).toEqual([])
  })

  it('2년을 초과하면 무기계약 전환 가능성을 알린다', () => {
    const issues = checkPeriodCompliance(
      { contractStartDate: '2026-01-01', contractEndDate: '2028-07-01' },
      NOW
    )
    const issue = issues.find((i) => i.title.includes('2년 초과'))
    expect(issue).toBeTruthy()
    expect(issue.detail).toContain('기간의 정함이 없는 근로계약')
  })

  it('종료일이 시작일보다 앞서면 오류로 잡는다', () => {
    const issues = checkPeriodCompliance(
      { contractStartDate: '2027-01-01', contractEndDate: '2026-01-01' },
      NOW
    )
    expect(issues.some((i) => i.severity === 'high' && i.title.includes('기간'))).toBe(true)
  })

  it('기간의 정함이 없으면 기간 경고 대상이 아니다', () => {
    expect(checkPeriodCompliance({ contractStartDate: '2026-01-01' }, NOW)).toEqual([])
  })
})

describe('describeContinuousEmployment', () => {
  const chain = [
    { roomId: 'a', title: '1년차', startDate: '2024-03-01', endDate: '2025-02-28' },
    { roomId: 'b', title: '2년차', startDate: '2025-03-01', endDate: '2026-02-28' },
    { roomId: 'c', title: '3년차', startDate: '2026-03-01', endDate: '2027-02-28' },
  ]

  it('계약이 하나뿐이면 합산할 것이 없다', () => {
    expect(describeContinuousEmployment([chain[0]], NOW).linked).toBe(false)
  })

  it('이어진 계약의 기간을 합산한다', () => {
    const r = describeContinuousEmployment(chain, NOW)
    expect(r.linked).toBe(true)
    expect(r.count).toBe(3)
    expect(r.totalMonths).toBeGreaterThanOrEqual(35)
    expect(r.startDate).toBe('2024-03-01')
    expect(r.exceedsFixedTermLimit).toBe(true)
  })

  it('계약 하나만 보면 2년을 넘지 않아도 합산하면 넘는 것을 잡는다', () => {
    const each = describeContractPeriod(
      { contractStartDate: chain[2].startDate, contractEndDate: chain[2].endDate },
      NOW
    )
    expect(each.exceedsFixedTermLimit).toBe(false)
    expect(describeContinuousEmployment(chain, NOW).exceedsFixedTermLimit).toBe(true)
  })

  it('계약 사이 공백이 길면 표시한다', () => {
    const gapped = [
      { roomId: 'a', title: '이전', startDate: '2023-01-01', endDate: '2023-12-31' },
      { roomId: 'b', title: '이후', startDate: '2025-06-01', endDate: '2026-05-31' },
    ]
    const r = describeContinuousEmployment(gapped, NOW)
    expect(r.gaps.length).toBe(1)
    expect(r.gaps[0].afterRoomId).toBe('a')
  })

  it('진행 중인 마지막 계약은 오늘까지로 센다', () => {
    const open = [
      { roomId: 'a', title: '이전', startDate: '2024-09-01', endDate: '2025-08-31' },
      { roomId: 'b', title: '현재', startDate: '2025-09-01', endDate: null },
    ]
    const r = describeContinuousEmployment(open, NOW)
    expect(r.totalMonths).toBeGreaterThanOrEqual(23)
    expect(r.endDate).toBeNull()
  })
})

describe('checkContinuityCompliance', () => {
  it('이어지지 않았으면 경고하지 않는다', () => {
    expect(checkContinuityCompliance({ linked: false })).toEqual([])
    expect(checkContinuityCompliance(null)).toEqual([])
  })

  it('합산 2년 초과는 높은 등급으로 경고한다', () => {
    const issues = checkContinuityCompliance({
      linked: true,
      count: 3,
      totalMonths: 36,
      exceedsFixedTermLimit: true,
      gaps: [],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('high')
    expect(issues[0].detail).toContain('36개월')
  })

  it('공백이 있으면 단서를 함께 붙인다', () => {
    const issues = checkContinuityCompliance({
      linked: true,
      count: 2,
      totalMonths: 30,
      exceedsFixedTermLimit: true,
      gaps: [{ afterRoomId: 'a', days: 90 }],
    })
    expect(issues[0].detail).toContain('공백')
  })
})

describe('describeRetention', () => {
  it('계약 종료일부터 3년을 보존 기간으로 잡는다', () => {
    const r = describeRetention({ contractEndDate: '2026-12-31' }, null, NOW)
    expect(r.known).toBe(true)
    expect(r.until).toBe('2029-12-31')
    expect(r.expired).toBe(false)
    expect(r.detail).toContain('제42조')
  })

  it('종료일이 없으면 서명일을 기산일로 쓴다', () => {
    const r = describeRetention({}, '2026-01-10', NOW)
    expect(r.basis).toBe('2026-01-10')
    expect(r.until).toBe('2029-01-10')
  })

  it('보존 기간이 지나면 종료로 표시한다', () => {
    const r = describeRetention({ contractEndDate: '2020-01-01' }, null, NOW)
    expect(r.expired).toBe(true)
    expect(r.label).toContain('종료')
  })

  it('기산할 날짜가 없으면 알 수 없음', () => {
    expect(describeRetention({}, null, NOW).known).toBe(false)
  })
})
