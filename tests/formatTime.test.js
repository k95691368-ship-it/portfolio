// 서버가 남긴 UTC 시각을 한국 시각으로 보여 주는가.
//
// 서명 시각은 "언제 동의했는가"를 다투는 자리에서 근거가 되는 값이다.
// 표시가 아홉 시간 어긋나면 기록이 틀린 것과 같아진다.
import { describe, expect, it } from 'vitest'
import { formatKst, formatKstDate } from '../src/lib/formatTime.js'

describe('formatKst', () => {
  it('SQLite 형식(UTC)을 한국 시각으로 바꾼다', () => {
    // 한국시간 8월 8일 새벽 1시에 한 서명. 예전에는 "2026-08-07 16:00"으로 보였다.
    expect(formatKst('2026-08-07 16:00:00')).toBe('2026-08-08 01:00')
  })

  it('ISO 형식도 받는다', () => {
    expect(formatKst('2026-08-07T16:00:00Z')).toBe('2026-08-08 01:00')
  })

  it('날짜 경계를 넘기지 않는 시각은 그대로 아홉 시간만 더한다', () => {
    expect(formatKst('2026-08-07 00:30:00')).toBe('2026-08-07 09:30')
  })

  it('날짜만 필요한 자리도 한국 날짜로 준다', () => {
    expect(formatKstDate('2026-08-07 16:00:00')).toBe('2026-08-08')
  })

  it('빈 값과 잘못된 값은 빈 문자열', () => {
    expect(formatKst(null)).toBe('')
    expect(formatKst('')).toBe('')
    expect(formatKst('아무말')).toBe('')
  })
})
