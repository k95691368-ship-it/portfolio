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

  it('Segoe 계열을 우선하고 설치되지 않은 환경은 자체 호스팅 한국어 서체로 대체한다', () => {
    const css = read('src', 'index.css')
    const license = read('public', 'licenses', 'SUIT-OFL-1.1.txt')
    const display = css.match(/--font-display:\s*([^;]+);/)?.[1] ?? ''
    const body = css.match(/--font-body:\s*([^;]+);/)?.[1] ?? ''
    const mono = css.match(/--font-mono:\s*([^;]+);/)?.[1] ?? ''

    expect(display).toMatch(/^'Segoe UI Variable Display',\s*'Segoe UI Variable',\s*'Segoe UI',\s*'SUIT Variable'/)
    expect(body).toMatch(/^'Segoe UI Variable',\s*'Segoe UI',\s*'SUIT Variable'/)
    expect(display).toContain('sans-serif')
    expect(body).toContain('sans-serif')
    expect(mono).toContain("'Geist Mono'")
    expect(mono).toContain('monospace')
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(license).toContain('Reserved Font Name SUIT')
  })

  it('영웅 제목과 페이지 제목의 크기를 공유 토큰으로 구분한다', () => {
    const tokens = read('src', 'index.css')
    const css = read('src', 'App.css')
    const heading = css.match(/\.landing-hero h1\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(tokens).toMatch(/--text-4xl:\s*3\.75rem;/)
    expect(tokens).toMatch(/--text-3xl:\s*2\.75rem;/)
    expect(heading).toMatch(/font-size:[^;]*var\(--text-4xl\)/)
    expect(heading).toContain('word-break: keep-all')
    expect(css).toContain('font-family: var(--heading)')
  })

  it('영문 표시·코드 서체도 CDN 없이 WOFF2와 라이선스를 제공한다', () => {
    const css = read('src', 'fonts.css')
    for (const name of ['geist-mono']) {
      const filename = `${name}-latin-wght-normal.woff2`
      expect(css).toContain(filename)
      expect(existsSync(join(ROOT, 'node_modules', '@fontsource-variable', name, 'files', filename))).toBe(true)
      expect(read('public', 'licenses', `${name}-OFL.txt`)).toContain('SIL OPEN FONT LICENSE')
    }
    expect(css).not.toMatch(/https?:\/\//)
    expect(css).not.toContain('Plus Jakarta Sans')
  })
})
