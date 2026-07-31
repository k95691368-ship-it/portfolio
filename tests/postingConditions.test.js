import { describe, it, expect } from 'vitest'
import {
  normalizePostingConditions,
  postingConditionsFromRow,
  WAGE_TYPES,
} from '../functions/_lib/postingConditions.js'

describe('normalizePostingConditions', () => {
  it('아무것도 적지 않아도 통과한다 (모두 선택 항목)', () => {
    const r = normalizePostingConditions({})
    expect(r.error).toBeNull()
    expect(r.wageType).toBeNull()
    expect(r.wageMin).toBeNull()
  })

  it('쉼표와 원 표기를 숫자로 읽는다', () => {
    const r = normalizePostingConditions({ wageType: 'monthly', wageMin: '2,500,000원' })
    expect(r.wageMin).toBe(2500000)
  })

  it('임금 종류 없이 금액만 적으면 막는다', () => {
    expect(normalizePostingConditions({ wageMin: '2500000' }).error).toContain('선택해주세요')
  })

  it('종류만 고르고 금액이 없으면 막는다', () => {
    expect(normalizePostingConditions({ wageType: 'hourly' }).error).toContain('최소 금액')
  })

  it('상한이 하한보다 작으면 막는다', () => {
    const r = normalizePostingConditions({ wageType: 'monthly', wageMin: '3000000', wageMax: '2000000' })
    expect(r.error).toContain('상한')
  })

  it('알 수 없는 임금 종류는 무시한다', () => {
    // 종류가 무시되면 금액만 남아 앞선 규칙에 걸린다
    expect(normalizePostingConditions({ wageType: 'weekly', wageMin: '100' }).error).toBeTruthy()
  })

  it('시각 형식을 검사한다', () => {
    expect(normalizePostingConditions({ workHoursStart: '9시', workHoursEnd: '18:00' }).error).toContain(
      '09:00'
    )
    expect(normalizePostingConditions({ workHoursStart: '25:00', workHoursEnd: '18:00' }).error).toBeTruthy()
    expect(
      normalizePostingConditions({ workHoursStart: '09:00', workHoursEnd: '18:00' }).error
    ).toBeNull()
  })

  it('근무 시각은 시작과 종료를 함께 받아야 한다', () => {
    // 한쪽만 있으면 근로시간을 계산할 수 없어 대조에 쓰이지 못한다
    expect(normalizePostingConditions({ workHoursStart: '09:00' }).error).toContain('함께')
    expect(normalizePostingConditions({ workHoursEnd: '18:00' }).error).toContain('함께')
  })

  it('근무일은 길이를 제한한다', () => {
    const r = normalizePostingConditions({ workDays: 'x'.repeat(200) })
    expect(r.workDays.length).toBe(100)
  })

  it('임금 종류는 세 가지다', () => {
    expect(WAGE_TYPES).toEqual(['monthly', 'hourly', 'annual'])
  })
})

describe('postingConditionsFromRow', () => {
  it('DB 표기를 카멜 표기로 옮긴다', () => {
    const r = postingConditionsFromRow({
      wage_type: 'monthly',
      wage_min: 2500000,
      wage_max: 3000000,
      work_hours_start: '09:00',
      work_hours_end: '18:00',
      work_days: '주 5일',
    })
    expect(r).toEqual({
      wageType: 'monthly',
      wageMin: 2500000,
      wageMax: 3000000,
      workHoursStart: '09:00',
      workHoursEnd: '18:00',
      workDays: '주 5일',
    })
  })

  it('빈 행도 처리한다', () => {
    expect(postingConditionsFromRow(null).wageType).toBeNull()
  })
})
