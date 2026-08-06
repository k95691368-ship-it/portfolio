// 임금 구성항목과 최저임금 산입범위.
//
// 이 계산이 틀리면 양쪽으로 해롭다. 산입되는 수당을 빼고 보면 적법한 계약에
// 없는 위반을 만들고, 산입되지 않는 가산수당을 넣고 보면 진짜 위반을 통과시킨다.
import { describe, expect, it } from 'vitest'
import {
  normalizeWageItems,
  totalWage,
  minimumWageBase,
  effectiveWageItems,
  describeWageComposition,
} from '../functions/_lib/wageItems.js'
import { checkLegalCompliance } from '../functions/_lib/contractCheck.js'

const HOURS = {
  workHoursStart: '09:00',
  workHoursEnd: '18:00',
  workDays: '주 5일 (월~금)',
}

describe('normalizeWageItems', () => {
  it('정상 항목을 정리해 받는다', () => {
    const r = normalizeWageItems([
      { name: '기본급', type: 'base', amount: '2000000' },
      { name: '식대', type: 'welfare', amount: 200000 },
    ])
    expect(r.ok).toBe(true)
    expect(r.items).toHaveLength(2)
    expect(r.items[0].amount).toBe(2000000)
  })

  it('빈 줄은 조용히 버린다', () => {
    const r = normalizeWageItems([
      { name: '기본급', type: 'base', amount: 2000000 },
      { name: '', type: '', amount: '' },
    ])
    expect(r.items).toHaveLength(1)
  })

  it('종류가 분명하지 않으면 받지 않는다', () => {
    // 알 수 없는 종류를 '기타'로 두면 산입 여부를 마음대로 정하는 셈이 된다.
    expect(normalizeWageItems([{ name: '수당', type: '알수없음', amount: 100 }]).ok).toBe(false)
  })

  it('음수·비숫자 금액을 막는다', () => {
    expect(normalizeWageItems([{ name: '기본급', type: 'base', amount: -1 }]).ok).toBe(false)
    expect(normalizeWageItems([{ name: '기본급', type: 'base', amount: 'abc' }]).ok).toBe(false)
  })

  it('기본급이 없거나 둘이면 받지 않는다', () => {
    expect(normalizeWageItems([{ name: '식대', type: 'welfare', amount: 200000 }]).ok).toBe(false)
    expect(
      normalizeWageItems([
        { name: '기본급', type: 'base', amount: 100 },
        { name: '기본급2', type: 'base', amount: 100 },
      ]).ok
    ).toBe(false)
  })

  it('빈 배열은 그대로 통과한다', () => {
    expect(normalizeWageItems([]).ok).toBe(true)
    expect(normalizeWageItems(undefined).items).toEqual([])
  })
})

describe('최저임금 산입범위', () => {
  const items = [
    { name: '기본급', type: 'base', amount: 1800000 },
    { name: '직책수당', type: 'fixed_allowance', amount: 100000 },
    { name: '식대', type: 'welfare', amount: 200000 },
    { name: '고정연장수당', type: 'overtime_fixed', amount: 400000 },
    { name: '명절상여', type: 'irregular_bonus', amount: 300000 },
  ]

  it('지급액 합계는 전부를 더한다', () => {
    expect(totalWage(items)).toBe(2800000)
  })

  // 2024년부터 매월 지급 상여금과 현금성 복리후생비는 전액 산입된다.
  // 소정근로 외의 대가(가산수당)와 부정기 상여는 산입되지 않는다.
  it('산입 대상은 소정근로의 대가만 더한다', () => {
    expect(minimumWageBase(items)).toBe(2100000)
  })

  it('구성이 없으면 기본급 하나로 본다', () => {
    const eff = effectiveWageItems({ wageBaseAmount: 2500000, wageItems: [] })
    expect(eff).toHaveLength(1)
    expect(minimumWageBase(eff)).toBe(2500000)
  })

  it('요약이 제외된 항목을 이름으로 밝힌다', () => {
    const d = describeWageComposition({ wageItems: items })
    expect(d.hasExcluded).toBe(true)
    expect(d.detail).toContain('고정연장수당')
    expect(d.minimumWageBase).toBe(2100000)
  })
})

describe('최저임금 판정이 구성항목을 반영한다', () => {
  // 주 40시간이면 월 소정근로 약 209시간, 적법 하한은 약 2,152,460원이다.

  it('식대가 붙어 하한을 넘으면 위반이라 하지 않는다', () => {
    // 기본급만 보면 190만이라 미달로 읽히지만, 식대까지 산입하면 220만이다.
    const terms = {
      ...HOURS,
      wageBaseAmount: 1900000,
      wageItems: [
        { name: '기본급', type: 'base', amount: 1900000 },
        { name: '식대', type: 'welfare', amount: 300000 },
      ],
    }
    const titles = checkLegalCompliance(terms).map((i) => i.title)
    expect(titles, '적법한 계약에 없는 위반을 만들면 안 됩니다').not.toContain('최저임금 미달 소지')
  })

  it('합계는 넉넉해도 가산수당을 빼면 미달이면 잡는다', () => {
    // 합계 232만이지만 고정연장수당 42만은 산입되지 않아 190만이 기준이다.
    const terms = {
      ...HOURS,
      wageBaseAmount: 1900000,
      wageItems: [
        { name: '기본급', type: 'base', amount: 1900000 },
        { name: '고정연장수당', type: 'overtime_fixed', amount: 420000 },
      ],
    }
    const issue = checkLegalCompliance(terms).find((i) => i.title === '최저임금 미달 소지')
    expect(issue, '가산수당을 산입하면 진짜 위반을 놓칩니다').toBeTruthy()
    expect(issue.detail).toContain('제6조 제4항')
    expect(issue.detail).toContain('2,320,000')
  })

  it('구성항목이 없는 기존 계약은 예전과 똑같이 계산된다', () => {
    const before = checkLegalCompliance({ ...HOURS, wageBaseAmount: 1900000 })
    expect(before.map((i) => i.title)).toContain('최저임금 미달 소지')
    const ok = checkLegalCompliance({ ...HOURS, wageBaseAmount: 2500000 })
    expect(ok.map((i) => i.title)).not.toContain('최저임금 미달 소지')
  })
})
