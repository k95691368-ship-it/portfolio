import { describe, it, expect } from 'vitest'
import {
  resolveTheme,
  nextTheme,
  isTheme,
  themeLabel,
  toggleLabel,
  readStoredTheme,
  writeStoredTheme,
  THEME_KEY,
} from '../src/lib/theme.js'

describe('resolveTheme', () => {
  it('고른 값이 있으면 기기 설정보다 그것을 따른다', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('고른 값이 없으면 기기 설정을 따른다', () => {
    expect(resolveTheme(null, true)).toBe('dark')
    expect(resolveTheme(null, false)).toBe('light')
  })

  it('알 수 없는 값은 고르지 않은 것으로 본다', () => {
    expect(resolveTheme('보라색', true)).toBe('dark')
    expect(resolveTheme('', false)).toBe('light')
    expect(resolveTheme(undefined, true)).toBe('dark')
  })
})

describe('nextTheme', () => {
  it('두 상태를 오간다', () => {
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('light')
  })
})

describe('isTheme', () => {
  it('아는 값만 참', () => {
    expect(isTheme('light')).toBe(true)
    expect(isTheme('dark')).toBe(true)
    expect(isTheme('auto')).toBe(false)
    expect(isTheme(null)).toBe(false)
  })
})

describe('라벨', () => {
  it('지금 상태를 한국어로 말한다', () => {
    expect(themeLabel('dark')).toBe('어두운 화면')
    expect(themeLabel('light')).toBe('밝은 화면')
  })

  it('버튼 설명은 누르면 무엇이 되는지를 말한다', () => {
    expect(toggleLabel('light')).toBe('어두운 화면으로 바꾸기')
    expect(toggleLabel('dark')).toBe('밝은 화면으로 바꾸기')
  })
})

describe('저장소', () => {
  function fakeStorage(initial) {
    const map = new Map(Object.entries(initial || {}))
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, v),
      _map: map,
    }
  }

  it('저장된 값을 읽는다', () => {
    expect(readStoredTheme(fakeStorage({ [THEME_KEY]: 'dark' }))).toBe('dark')
    expect(readStoredTheme(fakeStorage({}))).toBeNull()
  })

  it('이상한 값이 들어 있으면 무시한다', () => {
    expect(readStoredTheme(fakeStorage({ [THEME_KEY]: '{}' }))).toBeNull()
  })

  it('저장소를 쓸 수 없어도 죽지 않는다', () => {
    const broken = {
      getItem: () => {
        throw new Error('접근 거부')
      },
      setItem: () => {
        throw new Error('접근 거부')
      },
    }
    expect(readStoredTheme(broken)).toBeNull()
    expect(writeStoredTheme(broken, 'dark')).toBe(false)
    expect(readStoredTheme(null)).toBeNull()
  })

  it('고른 값을 저장한다', () => {
    const s = fakeStorage({})
    expect(writeStoredTheme(s, 'dark')).toBe(true)
    expect(readStoredTheme(s)).toBe('dark')
  })
})
