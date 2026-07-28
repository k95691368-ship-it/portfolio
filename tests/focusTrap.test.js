import { describe, it, expect } from 'vitest'
import { wrapFocusIndex, initialFocusIndex, FOCUSABLE_SELECTOR } from '../src/lib/focusTrap.js'

describe('wrapFocusIndex', () => {
  it('가운데에서는 그대로 둔다', () => {
    expect(wrapFocusIndex(4, 1, false)).toBeNull()
    expect(wrapFocusIndex(4, 2, true)).toBeNull()
  })

  it('마지막에서 탭을 누르면 처음으로 돌아간다', () => {
    expect(wrapFocusIndex(4, 3, false)).toBe(0)
  })

  it('처음에서 시프트+탭을 누르면 마지막으로 돌아간다', () => {
    expect(wrapFocusIndex(4, 0, true)).toBe(3)
  })

  it('초점이 창 자체에 있을 때도 밖으로 나가지 않는다', () => {
    // -1은 목록 밖(창 자체)에 있다는 뜻
    expect(wrapFocusIndex(4, -1, true)).toBe(3)
    // 앞으로 갈 때는 브라우저가 알아서 첫 요소로 들어간다
    expect(wrapFocusIndex(4, -1, false)).toBeNull()
  })

  it('옮길 곳이 하나뿐이면 늘 그 자리에 머문다', () => {
    expect(wrapFocusIndex(1, 0, false)).toBe(0)
    expect(wrapFocusIndex(1, 0, true)).toBe(0)
  })

  it('옮길 곳이 없으면 아무것도 하지 않는다', () => {
    expect(wrapFocusIndex(0, -1, false)).toBeNull()
    expect(wrapFocusIndex(0, -1, true)).toBeNull()
  })
})

describe('initialFocusIndex', () => {
  it('안에 옮길 곳이 있으면 첫 번째로', () => {
    expect(initialFocusIndex(3)).toBe(0)
  })
  it('없으면 창 자체로', () => {
    expect(initialFocusIndex(0)).toBe(-1)
  })
})

describe('FOCUSABLE_SELECTOR', () => {
  it('막힌 요소와 탭 대상이 아닌 것은 고르지 않는다', () => {
    expect(FOCUSABLE_SELECTOR).toContain('button:not([disabled])')
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])')
  })
})
