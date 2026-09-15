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

  it('화면용 서체와 한국어 대체 서체를 분리하고 라이선스를 보존한다', () => {
    const css = read('src', 'index.css')
    const license = read('public', 'licenses', 'SUIT-OFL-1.1.txt')
    expect(css).toContain("--font-display: 'Plus Jakarta Sans', 'SUIT Variable'")
    expect(css).toContain("--font-body: Aptos, 'Segoe UI', 'SUIT Variable'")
    expect(css).toContain("--font-mono: 'Geist Mono', 'SUIT Variable'")
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(license).toContain('Reserved Font Name SUIT')
  })

  it('Microsoft 기준의 압축된 제목과 선택 영역 위계를 사용한다', () => {
    const css = read('src', 'redesign.css')
    const heading = css.match(/\.landing-hero h1\s*\{([^}]*)\}/)?.[1] ?? ''
    const choice = css.match(/\.landing-choice\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(heading).toContain('font-weight: 800')
    expect(heading).toContain('font-size: var(--text-4xl)')
    expect(heading).toContain('line-height: 1.2')
    expect(choice).toContain('font-size: var(--text-lg)')
    expect(choice).toContain('font-weight: 700')
    expect(choice).toContain('min-height: 76px')
  })

  it('영문 표시·코드 서체도 CDN 없이 WOFF2와 라이선스를 제공한다', () => {
    const css = read('src', 'fonts.css')
    for (const name of ['plus-jakarta-sans', 'geist-mono']) {
      const filename = `${name}-latin-wght-normal.woff2`
      expect(css).toContain(filename)
      expect(existsSync(join(ROOT, 'node_modules', '@fontsource-variable', name, 'files', filename))).toBe(true)
      expect(read('public', 'licenses', `${name}-OFL.txt`)).toContain('SIL OPEN FONT LICENSE')
    }
    expect(css).not.toMatch(/https?:\/\//)
  })
})
