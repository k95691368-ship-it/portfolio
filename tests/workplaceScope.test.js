// 상시 근로자 수에 따라 어느 조항이 적용되는가.
//
// 근로기준법 제11조 제1항은 이 법을 상시 5명 이상 사업장에 적용한다. 제2항과
// 시행령 제7조 별표1에 따라 4명 이하 사업장에는 제53조·제56조·제60조가
// 적용되지 않는다. 이 구분이 없으면 두 방향으로 틀린다 — 적용되지 않는 조항으로
// 서명을 막거나, 발생하지 않는 권리를 확정 금액으로 약속하거나.
import { describe, expect, it } from 'vitest'
import { workplaceScope, SMALL_WORKPLACE_THRESHOLD } from '../functions/_lib/workplaceScope.js'
import { checkLegalCompliance } from '../functions/_lib/contractCheck.js'
import { describeAnnualLeave, describeOvertimeRates } from '../functions/_lib/workerRights.js'
import { describeCancellationRisk } from '../functions/_lib/jobOffer.js'

const NOW = new Date(Date.UTC(2026, 8, 15))

// 주 66시간 — 5명 이상이면 제53조 위반, 4명 이하면 위반이 아니다.
const LONG_HOURS = {
  contractStartDate: '2026-09-01',
  workHoursStart: '09:00',
  workHoursEnd: '20:00',
  workDays: '주 6일',
  restDays: '일',
  wageBaseAmount: 3000000,
  wagePayMethod: '계좌이체',
  wagePayDate: '매월 25일',
  annualLeave: '근로기준법에 따름',
  employerName: 'A',
  employeeName: 'B',
  workLocation: '서울',
  jobDescription: '운영',
}

describe('workplaceScope', () => {
  it('5명이 경계다', () => {
    expect(SMALL_WORKPLACE_THRESHOLD).toBe(5)
    expect(workplaceScope({ employeeCount: 4 }).small).toBe(true)
    // DB 행을 그대로 넘기는 호출부가 있다. 카멜만 읽으면 그 경로에서 규모가
    // '모름'으로 떨어져, 4명 이하 사업장에 제23조·제28조를 그대로 안내한다.
    expect(workplaceScope({ employee_count: 4 }).small).toBe(true)
    expect(workplaceScope({ employee_count: 3 }).count).toBe(3)
    expect(workplaceScope({ employee_count: 9 }).small).toBe(false)
    expect(workplaceScope({ employeeCount: 5 }).small).toBe(false)
  })

  it('비어 있으면 모름이고, 모를 때는 5명 이상으로 본다', () => {
    for (const v of [undefined, null, '', 0, -1, 'many']) {
      const s = workplaceScope({ employeeCount: v })
      expect(s.known).toBe(false)
      expect(s.small).toBe(false)
    }
  })
})

describe('4명 이하 사업장', () => {
  it('주 52시간 초과로 서명을 막지 않는다', () => {
    const many = checkLegalCompliance({ ...LONG_HOURS, employeeCount: 10 })
    expect(many.some((i) => i.title === '주 52시간 초과' && i.severity === 'high')).toBe(true)

    const few = checkLegalCompliance({ ...LONG_HOURS, employeeCount: 3 })
    expect(few.some((i) => i.title === '주 52시간 초과')).toBe(false)
  })

  it('적용되지 않는다는 사실은 알린다 — 조용히 넘어가지 않는다', () => {
    const few = checkLegalCompliance({ ...LONG_HOURS, employeeCount: 3 })
    const note = few.find((i) => i.title.includes('미적용 사업장'))
    expect(note).toBeTruthy()
    expect(note.severity).toBe('info')
    expect(note.detail).toContain('제11조')
    expect(note.detail).toContain('최저임금')
  })

  it('생기지 않는 연차를 날짜와 일수로 약속하지 않는다', () => {
    const a = describeAnnualLeave({ ...LONG_HOURS, employeeCount: 3 }, NOW)
    expect(a.applies).toBe(false)
    expect(a.byYear).toBeUndefined()
    expect(a.reason).toContain('제60조')
  })

  it('받을 수 없는 가산수당 단가를 제시하지 않는다', () => {
    const o = describeOvertimeRates({ ...LONG_HOURS, employeeCount: 3 })
    expect(o.known).toBe(false)
    expect(o.notApplicable).toBe(true)
    expect(o.reason).toContain('제56조')
  })
})

describe('규모를 모를 때', () => {
  it('5명 이상으로 판정하되 그것이 전제임을 밝힌다', () => {
    const issues = checkLegalCompliance(LONG_HOURS)
    const over = issues.find((i) => i.title === '주 52시간 초과')
    expect(over.severity).toBe('high')
    expect(over.detail).toContain('상시 4명 이하라면')
  })

  it('규모를 적으면 단서를 붙이지 않는다', () => {
    const issues = checkLegalCompliance({ ...LONG_HOURS, employeeCount: 10 })
    const over = issues.find((i) => i.title === '주 52시간 초과')
    expect(over.detail).not.toContain('상시 4명 이하라면')
  })
})

// 해고 안내가 사업장 규모를 실제로 반영하는가.
//
// describeCancellationRisk 는 DB 행을 그대로 받는 경로에서 불린다. 규모를
// 못 읽으면 4명 이하 사업장에도 "노동위원회에 부당해고 구제신청"을 붙인다 --
// 제23조도 제28조도 적용되지 않는 곳에 대고 하는 말이다.
describe('채용내정 취소 안내와 사업장 규모', () => {
  it('DB 행(employee_count)으로도 4명 이하를 알아본다', () => {
    const risk = describeCancellationRisk({ employee_count: 3 })
    expect(risk.remedies).not.toContain('노동위원회에 부당해고 구제신청')
    expect(risk.scopeNote).toContain('4명 이하')
    // 작아서 안전하다고 읽히면 안 된다. 손해배상은 그대로 남는다.
    expect(risk.scopeNote).toContain('손해배상')
  })

  it('5명 이상이면 구제신청을 함께 안내한다', () => {
    const risk = describeCancellationRisk({ employee_count: 9 })
    expect(risk.remedies).toContain('노동위원회에 부당해고 구제신청')
  })

  it('규모를 모르면 근로자에게 유리한 쪽으로 보되 그것이 전제임을 밝힌다', () => {
    const risk = describeCancellationRisk({})
    expect(risk.remedies).toContain('노동위원회에 부당해고 구제신청')
    expect(risk.scopeNote).toContain('전제')
  })
})
