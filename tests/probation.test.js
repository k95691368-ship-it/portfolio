// 수습기간 감액이 법정 한도를 넘는지 확인한다.
//
// 수습은 "그동안은 덜 줘도 된다"로 널리 오해되는 자리라, 위반이 가장 흔하면서도
// 당사자 둘 다 위반인 줄 모르고 넘어간다. 값이 정해진 규칙이므로 계산으로 잡는다.
import { describe, expect, it } from 'vitest'
import { parseProbation, checkProbationCompliance } from '../functions/_lib/probation.js'

const BASE = {
  contractStartDate: '2026-09-01',
  contractEndDate: null, // 무기계약 = 1년 이상
  workHoursStart: '09:00',
  workHoursEnd: '18:00',
  workDays: '주 5일 (월~금)',
  wageBaseAmount: 2900000,
  customTerms: [],
}

const withProbation = (value, over = {}) => ({
  ...BASE,
  ...over,
  customTerms: [{ label: '수습기간', value }],
})

describe('parseProbation', () => {
  it('개월과 지급률을 읽는다', () => {
    const p = parseProbation(withProbation('6개월 (수습 중 임금의 80% 지급)'))
    expect(p.found).toBe(true)
    expect(p.months).toBe(6)
    expect(p.payRatio).toBe(80)
  })

  it('감액 없음을 100%로 읽는다', () => {
    const p = parseProbation(withProbation('3개월 (임금 감액 없음)'))
    expect(p.months).toBe(3)
    expect(p.payRatio).toBe(100)
  })

  // "10% 감액"을 지급률로 읽으면 10%만 준다는 뜻이 되어, 정상 계약이
  // 최악의 위반으로 뒤집힌다. 깎는 폭 표기를 먼저 봐야 한다.
  it('감액 폭 표기를 지급률로 착각하지 않는다', () => {
    expect(parseProbation(withProbation('3개월, 10% 감액')).payRatio).toBe(90)
  })

  it('일 단위 기간도 읽는다', () => {
    expect(parseProbation(withProbation('90일간 90% 지급')).months).toBe(3)
  })

  it('수습 조항이 없으면 찾지 못한 것으로 둔다', () => {
    expect(parseProbation(BASE).found).toBe(false)
    expect(parseProbation({ ...BASE, customTerms: [{ label: '퇴직급여', value: '법에 따름' }] }).found).toBe(false)
  })

  it('읽을 수 없는 표기는 단정하지 않는다', () => {
    const p = parseProbation(withProbation('별도 협의'))
    expect(p.found).toBe(true)
    expect(p.months).toBeNull()
    expect(p.payRatio).toBeNull()
  })
})

describe('checkProbationCompliance', () => {
  it('수습 조항이 없으면 아무 말도 하지 않는다', () => {
    expect(checkProbationCompliance(BASE)).toHaveLength(0)
  })

  it('감액이 없으면 기간이 길어도 문제 삼지 않는다', () => {
    // 수습 기간 자체를 길게 두는 것은 감액과 별개다.
    expect(checkProbationCompliance(withProbation('6개월 (임금 감액 없음)'))).toHaveLength(0)
  })

  it('3개월 이내 10% 이내 감액은 위반으로 잡지 않는다', () => {
    // 단순노무업무 단서 안내(info)는 별개다 — 위반 판정은 없어야 한다.
    const issues = checkProbationCompliance(withProbation('3개월 (임금의 90% 지급)'))
    expect(issues.filter((i) => i.severity !== 'info')).toHaveLength(0)
  })

  it('3개월을 넘겨 감액하면 잡는다', () => {
    const titles = checkProbationCompliance(withProbation('6개월 (임금의 90% 지급)')).map((i) => i.title)
    expect(titles).toContain('수습 감액 기간 초과')
  })

  // 법이 정한 하한은 '계약 임금의 90%'가 아니라 '최저임금의 90%'다.
  // 지급률만 보고 판정하면 임금이 넉넉한 계약이 위반으로 잡혀 서명이 막힌다.
  it('실제 지급액이 법정 하한 아래일 때만 잡는다', () => {
    const issue = checkProbationCompliance(
      withProbation('3개월 (임금의 80% 지급)', { wageBaseAmount: 2000000 })
    ).find((i) => i.title === '수습 감액 한도 초과')
    expect(issue.severity).toBe('high')
    expect(issue.detail).toContain('시행령 제3조')
    expect(issue.detail).toMatch(/[0-9,]+원/)
  })

  it('임금이 넉넉하면 80% 지급도 적법하다', () => {
    // 290만원의 80%는 232만원. 최저임금의 90%(약 194만원)를 한참 웃돈다.
    const titles = checkProbationCompliance(withProbation('3개월 (임금의 80% 지급)')).map(
      (i) => i.title
    )
    expect(titles).not.toContain('수습 감액 한도 초과')
  })

  it('금액을 계산할 수 없으면 단정하지 않고 확인만 요청한다', () => {
    const issue = checkProbationCompliance(
      withProbation('3개월 (임금의 80% 지급)', { wageBaseAmount: null })
    ).find((i) => i.title === '수습 지급액 확인 필요')
    expect(issue.severity).toBe('medium')
  })

  it('1년 미만 계약에서는 감액 자체를 막는다', () => {
    const titles = checkProbationCompliance(
      withProbation('3개월 (임금의 95% 지급)', { contractEndDate: '2027-02-28' })
    ).map((i) => i.title)
    expect(titles).toContain('수습 감액 불가 계약')
  })

  it('1년 이상 계약이면 감액 자체는 막지 않는다', () => {
    const titles = checkProbationCompliance(
      withProbation('3개월 (임금의 95% 지급)', { contractEndDate: '2027-08-31' })
    ).map((i) => i.title)
    expect(titles).not.toContain('수습 감액 불가 계약')
  })

  // 9월 1일 시작해 이듬해 8월 31일 끝나는 계약은 1년이다. 종료일을 근무일로
  // 세지 않으면 11개월이 되어, 가장 흔한 1년 계약에 "감액 불가" 오경고가 붙는다.
  it('9월 1일~이듬해 8월 31일을 1년으로 센다', () => {
    const titles = checkProbationCompliance(
      withProbation('3개월 (임금의 95% 지급)', {
        contractStartDate: '2026-09-01',
        contractEndDate: '2027-08-31',
      })
    ).map((i) => i.title)
    expect(titles).not.toContain('수습 감액 불가 계약')
  })

  it('11개월 계약은 여전히 감액 불가로 잡는다', () => {
    const titles = checkProbationCompliance(
      withProbation('3개월 (임금의 95% 지급)', {
        contractStartDate: '2026-09-01',
        contractEndDate: '2027-07-31',
      })
    ).map((i) => i.title)
    expect(titles).toContain('수습 감액 불가 계약')
  })

  it('데모에 심은 6개월 80%는 두 가지가 함께 걸린다', () => {
    // 데모 방 B의 기본급은 190만원이라 80%면 152만원 — 하한 아래다.
    const titles = checkProbationCompliance(
      withProbation('6개월 (수습 중 임금의 80% 지급)', { wageBaseAmount: 1900000 })
    ).map((i) => i.title)
    expect(titles).toContain('수습 감액 기간 초과')
    expect(titles).toContain('수습 감액 한도 초과')
  })
})

// 최저임금법 제5조 제2항 단서 (2018.3.20 신설)
// "다만, 단순노무업무로 고용노동부장관이 정하여 고시한 직종에 종사하는
//  근로자는 제외한다."
//
// 업무의 내용은 자유 입력이라 코드가 직종을 분류할 수 없다. 분류할 수 없는
// 것을 분류한 척하지 않되, 그런 단서가 있다는 사실은 반드시 알려야 한다.
describe('단순노무업무 단서', () => {
  it('감액이 있으면 단서를 함께 알린다', () => {
    const issues = checkProbationCompliance(withProbation('3개월 (임금의 95% 지급)'))
    const note = issues.find((i) => i.title.includes('단순노무'))
    expect(note).toBeTruthy()
    expect(note.severity).toBe('info')
    expect(note.detail).toContain('제5조 제2항')
  })

  it('감액이 없으면 알리지 않는다 — 상관없는 경고를 늘리지 않는다', () => {
    const issues = checkProbationCompliance(withProbation('3개월 (임금 감액 없음)'))
    expect(issues.some((i) => i.title.includes('단순노무'))).toBe(false)
  })
})
