import { describe, expect, it } from 'vitest'
import {
  parseContractDate,
  monthsBetween,
  describeContractPeriod,
  checkPeriodCompliance,
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

  it('2년 초과 여부를 계산한다', () => {
    const two = describeContractPeriod(
      { contractStartDate: '2026-01-01', contractEndDate: '2028-01-01' },
      NOW
    )
    expect(two.months).toBe(24)
    expect(two.exceedsFixedTermLimit).toBe(false)

    const over = describeContractPeriod(
      { contractStartDate: '2026-01-01', contractEndDate: '2028-03-01' },
      NOW
    )
    expect(over.exceedsFixedTermLimit).toBe(true)
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
