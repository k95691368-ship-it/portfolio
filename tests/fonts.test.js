import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8')

describe('전역 UI 글꼴', () => {
  it('이름만 선언하지 않고 Pretendard 가변 서브셋 파일을 실제로 묶는다', () => {
    const entry = read('src', 'main.jsx')
    const fontCss = read(
      'node_modules',
      'pretendard',
      'dist',
      'web',
      'variable',
      'pretendardvariable-dynamic-subset.css'
    )

    expect(entry).toContain(
      "import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'"
    )
    expect(fontCss).toContain('@font-face')
    expect(fontCss).toContain("font-family: 'Pretendard Variable'")
    expect(fontCss).toContain('woff2-dynamic-subset')
    expect(fontCss).toContain('unicode-range:')
  })

  it('번들 글꼴을 시스템 글꼴보다 먼저 두고 OFL 원문을 함께 배포한다', () => {
    const css = read('src', 'index.css')
    const apple = css.indexOf('-apple-system')
    const pretendard = css.indexOf("'Pretendard Variable'")
    const windowsFallback = css.indexOf("'Malgun Gothic'")
    const license = read('public', 'licenses', 'Pretendard-OFL-1.1.txt')

    expect(apple).toBeGreaterThan(-1)
    expect(pretendard).toBeGreaterThan(-1)
    expect(apple).toBeGreaterThan(pretendard)
    expect(windowsFallback).toBeGreaterThan(apple)
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(license).toContain("Reserved Font Name 'Pretendard'")
  })

  it('한국어 랜딩 제목은 Apple식 Semibold와 기본 자간을 사용한다', () => {
    const css = read('src', 'redesign.css')
    const heading = css.match(/\.landing-hero h1\s*\{([^}]*)\}/)?.[1] ?? ''
    const choice = css.match(/\.landing-choice-title\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(heading).toContain('font-weight: 600')
    expect(heading).toContain('line-height: 1.0835')
    expect(heading).toContain('letter-spacing: 0')
    expect(choice).toContain('font-weight: 600')
    expect(choice).toContain('letter-spacing: 0')
  })
})
