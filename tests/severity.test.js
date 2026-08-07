import { describe, it, expect } from 'vitest'
import { severityClass, severityWord } from '../src/lib/severity.js'

describe('심각도 표시', () => {
  it('심각도마다 말과 색이 함께 정해진다', () => {
    expect(severityWord('high')).toBe('심각')
    expect(severityWord('medium')).toBe('주의')
    expect(severityWord('info')).toBe('참고')
    expect(severityClass('high')).toBe('badge-danger')
    expect(severityClass('medium')).toBe('badge-warning')
    expect(severityClass('info')).toBe('badge-neutral')
  })

  it('모르는 값은 가장 약한 쪽으로 읽는다', () => {
    // 없는 심각도를 지어내 겁주면, 진짜 경고까지 무시된다.
    for (const bad of [undefined, null, '', 'critical', 'HIGH', 0]) {
      expect(severityWord(bad)).toBe('참고')
      expect(severityClass(bad)).toBe('badge-neutral')
    }
  })

  it('색이 사라져도 심각도가 남는다', () => {
    // 같은 색을 쓰는 심각도가 둘 있으면 색을 못 보는 사람에게는 구분이 사라진다.
    const words = ['high', 'medium', 'info'].map(severityWord)
    expect(new Set(words).size).toBe(3)
  })
})
