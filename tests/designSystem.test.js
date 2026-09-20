import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8')

function token(css, name) {
  return css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim()
}

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((channel) => {
    const value = Number.parseInt(channel, 16) / 255
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  })
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
}

function contrast(a, b) {
  const pair = [luminance(a), luminance(b)].sort((first, second) => second - first)
  return (pair[0] + .05) / (pair[1] + .05)
}

function rulesFor(css, selector) {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)
  return [...rules]
    .filter((rule) => rule[1].split(',').map((part) => part.trim()).includes(selector))
    .map((rule) => rule[2])
}

describe('Microsoft DESIGN.md 기반 화이트 UI 구조', () => {
  it('기존 회사·지원자 진입 동선과 보조 링크를 유지한다', () => {
    const page = read('src', 'pages', 'LandingPage.jsx')
    const css = read('src', 'redesign.css')
    const hero = css.match(/\.landing-hero\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(page).toContain('landing-choice--company')
    expect(page).toContain('landing-choice--candidate')
    expect(page).toContain('landing-actions')
    expect(page).not.toContain('ChoiceIcon')
    expect(hero).toContain('width: 100%')
    expect(css).toMatch(/\.landing-choice\s*\{[^}]*min-height:\s*(?:var\(--tap(?:-lg)?\)|(?:4[4-9]|[5-9][0-9])px)/)
    expect(css).toContain('.landing-choice--company')
  })

  it('모바일에서도 전역 이동 경로를 숨기지 않는다', () => {
    const app = read('src', 'App.jsx')
    const css = read('src', 'redesign.css')

    expect(app).toContain('className="mobile-nav"')
    expect(app).toContain('aria-label="모바일 주요 메뉴"')
    expect(css).toContain('.mobile-nav > nav')
    expect(css).toMatch(/(?:max-)?height:\s*calc\(100svh - var\(--nav-h\)\)/)
    expect(css).toContain('overflow-y: auto')
  })

  it('화이트 배경의 본문·보조 텍스트와 파란 버튼이 명도 대비를 확보한다', () => {
    const tokens = read('src', 'index.css')
    const css = read('src', 'redesign.css')

    expect(css).not.toMatch(/(?:linear|radial)-gradient/)
    expect(token(tokens, 'action-bg')).toBe('#0067b8')
    expect(token(tokens, 'action-hover')).toBe('#0078d4')
    for (const foreground of ['text', 'text-muted', 'brand-accent']) {
      for (const background of ['bg', 'surface', 'surface-alt']) {
        expect(contrast(token(tokens, foreground), token(tokens, background))).toBeGreaterThanOrEqual(4.5)
      }
    }
    expect(contrast(token(tokens, 'on-accent'), token(tokens, 'action-bg'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token(tokens, 'on-accent'), token(tokens, 'action-hover'))).toBeGreaterThanOrEqual(4.5)
    expect(css).toContain('.chat-row-right .chat-message')
    expect(css).toContain('.dm-bubble-row.mine .dm-bubble')
  })

  it('둥근 카드·입력·버튼의 위계와 키보드·움직임 감소 처리를 유지한다', () => {
    const tokens = read('src', 'index.css')
    const css = read('src', 'redesign.css')

    expect(token(tokens, 'radius')).toBe('20px')
    expect(token(tokens, 'radius-sm')).toBe('12px')
    expect(token(tokens, 'radius-full')).toBe('999px')
    expect(Number.parseFloat(token(tokens, 'tap'))).toBeGreaterThanOrEqual(44)
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--primary-focus\)/)
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('scroll-behavior: auto !important')
  })

  it('기술 문서는 키보드 탭과 네이티브 접기로 탐색한다', () => {
    const page = read('src', 'pages', 'TechPage.jsx')
    expect(page).toContain('className="tech-disclosure"')
    expect(page).toContain('<summary>')
    expect(page).toContain('role="tabpanel"')
    expect(page).toContain('aria-controls="tech-panel-system"')
    expect(page).toContain("['ArrowLeft', 'ArrowRight', 'Home', 'End']")
  })

  it('이전 카드 크기와 세로 정렬이 새 랜딩 버튼에 남지 않는다', () => {
    const app = read('src', 'App.jsx')
    const [choice] = rulesFor(read('src', 'redesign.css'), '.landing-choice')

    expect(app.indexOf("import './redesign.css'")).toBeGreaterThan(app.indexOf("import './App.css'"))
    expect(choice).toMatch(/flex-direction:\s*row;/)
    expect(choice).toMatch(/(?:^|;)\s*width:\s*auto;/)
    expect(choice).toMatch(/(?:^|;)\s*height:\s*auto;/)
  })

  it('내 채팅의 발신자와 역할이 밝은 말풍선 위에서 옅어지지 않는다', () => {
    const css = read('src', 'App.css') + '\n' + read('src', 'redesign.css')
    const role = rulesFor(css, '.chat-row-right .chat-role').join('\n')
    const sender = rulesFor(css, '.chat-row-right .chat-sender').join('\n')
    const tokens = read('src', 'index.css')

    expect(role).toMatch(/color:\s*var\(--text-muted\);/)
    expect(role).toMatch(/opacity:\s*1;/)
    expect(role).not.toMatch(/opacity:\s*0?\.[0-9]+|color:\s*(?:#fff(?:fff)?|white)\b/i)
    expect(sender).toMatch(/color:\s*var\(--text\);/)
    expect(contrast(token(tokens, 'text-muted'), token(tokens, 'accent-bg'))).toBeGreaterThanOrEqual(4.5)
  })

  it('기술 상세 글자에 예전 작은 크기의 important 재정의가 남지 않는다', () => {
    const legacyDetail = rulesFor(read('src', 'App.css'), '.tech-step-detail').join('\n')
    const detail = rulesFor(read('src', 'redesign.css'), '.tech-page .tech-step-detail').join('\n')

    expect(legacyDetail).not.toMatch(/font-size:\s*[^;]+!important/)
    expect(detail).toMatch(/font-size:\s*1rem;/)
  })

  it('전체 너비 푸터에 기존 최대 너비가 남지 않는다', () => {
    const footer = rulesFor(read('src', 'redesign.css'), '.app-legal-footer').join('\n')

    expect(footer).toMatch(/(?:^|;)\s*width:\s*100%;/)
    expect(footer).toMatch(/max-width:\s*none;/)
  })

  it('공개 공고는 데스크톱 두 열과 모바일 한 열을 명시한다', () => {
    const css = read('src', 'redesign.css')
    const [desktop] = rulesFor(css, '.jobs-page .job-list')
    const mobileCss = css.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const mobile = rulesFor(mobileCss, '.jobs-page .job-list').join('\n')

    expect(desktop).toMatch(/display:\s*grid;/)
    expect(desktop).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/)
    expect(mobile).toMatch(/grid-template-columns:\s*1fr;/)
  })
})
