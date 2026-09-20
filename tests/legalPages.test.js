import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe.each([
  ['privacy', '개인정보처리방침'],
  ['terms', '이용약관'],
])('public policy: %s', (route, title) => {
  const html = read(`${route}/index.html`)

  it('is a complete Korean document readable without JavaScript or login', () => {
    expect(html).toContain('<html lang="ko" data-theme="light">')
    expect(html).toContain('<meta name="theme-color" content="#ffffff">')
    expect(html).toContain(`<h1>${title}</h1>`)
    expect(html).toContain('김현욱')
    expect(html).toContain('mailto:k95691368@gmail.com')
    expect(html).not.toMatch(/<script\b|<iframe\b|<form\b/i)
  })

  it('uses a canonical production URL and the existing shared theme', () => {
    expect(html).toContain(`rel="canonical" href="https://portfolio-epa.pages.dev/${route}/"`)
    expect(html).toContain('href="/src/legal.css"')
    const css = read('src/legal.css')
    expect(css).toContain("@import './fonts.css'")
    expect(css).toContain("@import './index.css'")
  })

  it('uses the shared light typography and responsive policy layout', () => {
    const css = read('src/legal.css')
    const title = css.match(/\.policy-main h1\s*\{([^}]*)\}/)?.[1] ?? ''
    const toc = css.match(/\.policy-toc\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(title).toContain('font-family: var(--font-display)')
    expect(title).toContain('font-size: 44px')
    expect(title).toContain('font-weight: 600')
    expect(toc).toContain('padding: 32px')
    expect(toc).toContain('border-radius: 20px')
    expect(toc).toContain('background: var(--surface-alt)')
    expect(css).toContain('@media (max-width: 640px)')
    expect(css).toContain('grid-template-columns: 1fr')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('@media print')
  })

  it('has working section anchors with unique IDs and links to both policies', () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(ids).size).toBe(ids.length)
    const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1])
    expect(anchors.length).toBeGreaterThan(1)
    for (const anchor of anchors) expect(ids).toContain(anchor)
    expect(html).toContain('href="/privacy/"')
    expect(html).toContain('href="/terms/"')
    expect(html).toContain('href="/"')
  })
})

it('discloses the approved retention and send-only Gmail use without promising automatic deletion', () => {
  const privacy = read('privacy/index.html')
  expect(privacy).toContain('지원 접수 후 3년')
  expect(privacy).toContain('자동 삭제하는 시스템은 아닙니다')
  expect(privacy).toContain('gmail.send')
  expect(privacy).toContain('Limited Use')
  expect(privacy).toContain('받은편지함 읽기, 연락처 조회, 기존 메일 삭제 권한은 요청하지 않습니다')
})

it('links to static documents from the app footer instead of client-only routes', () => {
  const app = read('src/App.jsx')
  expect(app).toContain('<a href="/privacy/">개인정보처리방침</a>')
  expect(app).toContain('<a href="/terms/">이용약관</a>')
})
