import { describe, it, expect } from 'vitest'
import { explainContract } from '../functions/_lib/contractExplainer.js'

const NOW = new Date(Date.UTC(2026, 6, 30))

// 주 40시간 · 최저임금을 지키는 적법한 계약
const LAWFUL = {
  workHoursStart: '09:00',
  workHoursEnd: '18:00',
  workDays: '주 5일 (월~금)',
  restDays: '토요일, 일요일',
  wageBaseAmount: 2300000,
  wagePayMethod: '근로자 명의 예금통장 입금',
  wagePayDate: '매월 25일',
  annualLeave: '근로기준법에 따름',
  contractStartDate: '2026-09-01',
  contractEndDate: '2027-08-31',
  socialInsurance: {
    employment_insurance: true,
    health_insurance: true,
    national_pension: true,
    industrial_accident_insurance: true,
  },
}

function find(result, title, label) {
  const section = result.sections.find((s) => s.title === title)
  return section?.lines.find((l) => l.label === label)
}

describe('explainContract — 임금', () => {
  it('시급을 환산해 알려준다', () => {
    const r = explainContract(LAWFUL, NOW)
    const hourly = find(r, '임금', '시급 환산')
    // 주 40시간 → 월 소정근로 약 209시간 → 230만 / 209 ≈ 11,005원
    expect(hourly.value).toMatch(/^1[01],\d{3}원$/)
    expect(hourly.note).toContain('주휴시간 포함')
  })

  it('최저임금을 지키면 얼마나 높은지 알려준다', () => {
    const cmp = find(explainContract(LAWFUL, NOW), '임금', '최저임금 비교')
    expect(cmp.tone).toBe('ok')
    expect(cmp.value).toContain('높음')
    expect(cmp.note).toContain('10,320원')
  })

  it('미달이면 얼마나 부족한지와 적법한 금액을 알려준다', () => {
    const cmp = find(explainContract({ ...LAWFUL, wageBaseAmount: 1800000 }, NOW), '임금', '최저임금 비교')
    expect(cmp.tone).toBe('caution')
    expect(cmp.value).toContain('미달')
    expect(cmp.note).toContain('최소')
    expect(cmp.note).toContain('수정을 요청')
  })

  it('근무시간을 모르면 환산할 수 없다고 말한다', () => {
    const r = explainContract({ wageBaseAmount: 2300000 }, NOW)
    const hourly = find(r, '임금', '시급 환산')
    expect(hourly.value).toBe('계산할 수 없음')
    expect(hourly.tone).toBe('caution')
  })

  it('임금이 없으면 비어 있다고 표시한다', () => {
    const wage = find(explainContract({ ...LAWFUL, wageBaseAmount: null }, NOW), '임금', '월 지급액')
    expect(wage.value).toBe('적혀 있지 않음')
    expect(wage.tone).toBe('caution')
  })

  // 근로자용 해설이 기본급만 보고 판정하면, 같은 응답 안의 서명 전 점검과
  // 정반대 결론이 나온다. 근로자가 보는 쪽이 틀렸던 자리다.
  it('구성항목이 있으면 산입 대상만으로 최저임금을 따진다', () => {
    const terms = {
      ...LAWFUL,
      wageBaseAmount: 1900000,
      wageItems: [
        { name: '기본급', type: 'base', amount: 1900000 },
        { name: '고정연장수당', type: 'overtime_fixed', amount: 750000 },
      ],
    }
    const total = find(explainContract(terms, NOW), '임금', '월 지급액')
    expect(total.value).toContain('2,650,000')
    expect(total.note).toContain('750,000')
    const cmp = find(explainContract(terms, NOW), '임금', '최저임금 비교')
    expect(cmp.tone).toBe('caution')
    expect(cmp.value).toContain('미달')
  })
})

describe('explainContract — 근로시간', () => {
  it('휴게시간을 뺀 하루 근로시간을 알려준다', () => {
    const daily = find(explainContract(LAWFUL, NOW), '근로시간', '하루 근로시간')
    // 09:00~18:00 = 9시간, 8시간 초과이므로 휴게 1시간 제외
    expect(daily.value).toBe('8시간')
    expect(daily.note).toContain('제54조')
  })

  it('법정 한도 이내면 그렇게 말한다', () => {
    const limit = find(explainContract(LAWFUL, NOW), '근로시간', '법정 한도')
    expect(limit.tone).toBe('ok')
    expect(limit.value).toBe('이내')
  })

  it('40시간을 넘으면 가산수당을 알려준다', () => {
    const limit = find(
      explainContract({ ...LAWFUL, workDays: '주 6일 (월~토)' }, NOW),
      '근로시간',
      '법정 한도'
    )
    expect(limit.tone).toBe('caution')
    expect(limit.note).toContain('1.5배')
  })

  it('52시간을 넘으면 상한 초과로 말한다', () => {
    const limit = find(
      explainContract({ ...LAWFUL, workHoursEnd: '23:00', workDays: '주 6일 (월~토)' }, NOW),
      '근로시간',
      '법정 한도'
    )
    expect(limit.value).toBe('초과')
    expect(limit.tone).toBe('caution')
  })

  it('주 15시간 미만이면 주휴수당이 없다고 알려준다', () => {
    const weekly = find(
      explainContract({ ...LAWFUL, workDays: '주 1일 (토)', workHoursEnd: '17:00' }, NOW),
      '근로시간',
      '주휴수당'
    )
    expect(weekly.value).toBe('발생하지 않음')
    expect(weekly.tone).toBe('caution')
  })
})

describe('explainContract — 계약 기간', () => {
  it('기간의 정함이 없으면 해고 제한을 알려준다', () => {
    const p = find(explainContract({ ...LAWFUL, contractEndDate: null }, NOW), '계약 기간', '계약 기간')
    expect(p.value).toBe('기간의 정함 없음')
    expect(p.note).toContain('해고')
    expect(p.tone).toBe('ok')
  })

  it('2년 이내면 그렇게 말한다', () => {
    const limit = find(explainContract(LAWFUL, NOW), '계약 기간', '기간제 2년 상한')
    expect(limit.value).toBe('이내')
    expect(limit.tone).toBe('ok')
  })

  it('2년을 넘으면 무기계약 전환 가능성을 알려준다', () => {
    const limit = find(
      explainContract({ ...LAWFUL, contractStartDate: '2026-01-01', contractEndDate: '2028-06-30' }, NOW),
      '계약 기간',
      '기간제 2년 상한'
    )
    expect(limit.value).toBe('초과')
    expect(limit.note).toContain('제4조')
  })
})

describe('explainContract — 사회보험과 휴가', () => {
  it('적용 항목은 ok, 미적용은 주의로 표시한다', () => {
    const r = explainContract(
      { ...LAWFUL, socialInsurance: { employment_insurance: true, health_insurance: false } },
      NOW
    )
    const section = r.sections.find((s) => s.title === '사회보험')
    expect(section.lines.find((l) => l.label === '고용보험').tone).toBe('ok')
    expect(section.lines.find((l) => l.label === '건강보험').tone).toBe('caution')
  })

  it('연차가 비어 있으면 근거 조문을 함께 알려준다', () => {
    const leave = find(explainContract({ ...LAWFUL, annualLeave: '' }, NOW), '휴일과 휴가', '연차유급휴가')
    expect(leave.tone).toBe('caution')
    expect(leave.note).toContain('제60조')
  })
})

describe('explainContract — 전체', () => {
  it('적법한 계약은 확인할 항목이 없다', () => {
    const r = explainContract(LAWFUL, NOW)
    expect(r.cautionCount).toBe(0)
    expect(r.summary).toContain('확인이 필요한 항목이 없습니다')
  })

  it('문제가 있으면 개수를 세어 알려준다', () => {
    const r = explainContract({ ...LAWFUL, wageBaseAmount: 1000000, restDays: '' }, NOW)
    expect(r.cautionCount).toBeGreaterThan(0)
    expect(r.summary).toContain(`${r.cautionCount}가지`)
  })

  it('확인 목록에 교부 안내가 들어간다', () => {
    const r = explainContract(LAWFUL, NOW)
    const checklist = r.sections.find((s) => s.title === '서명 전에 확인할 것')
    expect(checklist.lines.some((l) => l.value.includes('교부'))).toBe(true)
  })

  it('값이 하나도 없어도 무너지지 않는다', () => {
    const r = explainContract(null, NOW)
    expect(r.sections.length).toBeGreaterThan(0)
    expect(r.cautionCount).toBeGreaterThan(0)
  })
})
