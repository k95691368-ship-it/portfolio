import { describe, it, expect } from 'vitest'
import { describeDeadline } from '../src/lib/deadline.js'

const NOW = new Date(Date.UTC(2026, 6, 28)) // 2026-07-28 기준으로 고정

describe('describeDeadline', () => {
  it('마감일이 없으면 상시 모집', () => {
    expect(describeDeadline(null, NOW).known).toBe(false)
    expect(describeDeadline('', NOW).label).toBe('상시 모집')
  })

  it('알 수 없는 표기는 상시 모집으로 둔다', () => {
    expect(describeDeadline('곧', NOW).known).toBe(false)
    expect(describeDeadline('2026-13-01', NOW).known).toBe(false)
    expect(describeDeadline('2026-02-30', NOW).known).toBe(false)
  })

  it('남은 날을 센다', () => {
    const r = describeDeadline('2026-08-27', NOW)
    expect(r.daysLeft).toBe(30)
    expect(r.label).toBe('마감 30일 전')
    expect(r.soon).toBe(false)
    expect(r.over).toBe(false)
  })

  it('오늘까지인 공고는 그렇게 말한다', () => {
    const r = describeDeadline('2026-07-28', NOW)
    expect(r.daysLeft).toBe(0)
    expect(r.label).toBe('오늘 마감')
    expect(r.soon).toBe(true)
    expect(r.over).toBe(false)
  })

  it('일주일 이내면 임박으로 본다', () => {
    expect(describeDeadline('2026-08-04', NOW).soon).toBe(true)
    expect(describeDeadline('2026-08-05', NOW).soon).toBe(false)
  })

  it('지난 마감일은 마감으로 표시한다', () => {
    const r = describeDeadline('2026-07-27', NOW)
    expect(r.over).toBe(true)
    expect(r.label).toBe('마감됨')
  })
})
