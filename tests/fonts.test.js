import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8')

describe('전역 UI 글꼴', () => {
  it('이름만 선언하지 않고 SUIT 가변 파일을 실제로 묶는다', () => {
    const entry = read('src', 'main.jsx')
    const suitCss = read('src', 'fonts.css')
    const suitFont = join(
      ROOT,
      'node_modules',
      '@sun-typeface',
      'suit',
      'fonts',
      'variable',
      'woff2',
      'SUIT-Variable.woff2'
    )
    expect(entry).toContain(
      "import './fonts.css'"
    )
    expect(suitCss).toContain("font-family: 'SUIT Variable'")
    expect(suitCss).toContain('SUIT-Variable.woff2')
    expect(suitCss).toContain('font-display: swap')
    expect(existsSync(suitFont)).toBe(true)
  })

  it('Apple에서는 시스템 서체, Windows에서는 번들 한글 서체를 먼저 쓴다', () => {
    const css = read('src', 'index.css')
    const apple = css.indexOf('-apple-system')
    const suit = css.indexOf("'SUIT Variable'")
    const windowsFallback = css.indexOf("'Malgun Gothic'")
    const license = read('public', 'licenses', 'SUIT-OFL-1.1.txt')

    expect(apple).toBeGreaterThan(-1)
    expect(suit).toBeGreaterThan(-1)
    expect(suit).toBeGreaterThan(apple)
    expect(windowsFallback).toBeGreaterThan(suit)
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(license).toContain('Reserved Font Name SUIT')
  })

  it('한국어 랜딩 제목과 CTA는 Apple식 타이포그래피 위계를 사용한다', () => {
    const css = read('src', 'redesign.css')
    const heading = css.match(/\.landing-hero h1\s*\{([^}]*)\}/)?.[1] ?? ''
    const choice = css.match(/\.landing-choice\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(heading).toContain('font-weight: 600')
    expect(heading).toContain('font-size: 3.5rem')
    expect(heading).toContain('line-height: 1.07')
    expect(heading).toContain('letter-spacing: -0.01em')
    expect(choice).toContain('font-size: 17px')
    expect(choice).toContain('font-weight: 400')
    expect(choice).toContain('line-height: 1.17647')
  })
})
