import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8')

describe('Apple식 UI 구조', () => {
  it('랜딩은 평면 히어로와 두 단계 CTA를 유지한다', () => {
    const page = read('src', 'pages', 'LandingPage.jsx')
    const css = read('src', 'redesign.css')
    const hero = css.match(/\.landing-hero\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(page).toContain('landing-choice--company')
    expect(page).toContain('landing-choice--candidate')
    expect(page).toContain('landing-actions')
    expect(page).not.toContain('ChoiceIcon')
    expect(hero).toContain('min-height: 580px')
    expect(hero).toContain('border-radius: 0')
  })

  it('모바일에서도 전역 이동 경로를 숨기지 않는다', () => {
    const app = read('src', 'App.jsx')
    const css = read('src', 'redesign.css')

    expect(app).toContain('className="mobile-nav"')
    expect(app).toContain('aria-label="모바일 주요 메뉴"')
    expect(css).toContain('.mobile-nav > nav')
    expect(css).toContain('height: calc(100svh - var(--nav-h))')
  })

  it('콘텐츠에 그라디언트를 쓰지 않고 다크 모드도 읽히는 액션 색을 분리한다', () => {
    const css = read('src', 'redesign.css')

    expect(css).not.toMatch(/(?:linear|radial)-gradient/)
    expect(css).toContain('--action-bg: #0071e3')
    expect(css).toContain('.chat-row-right .chat-message')
    expect(css).toContain('.dm-bubble-row.mine .dm-bubble')
  })
})
