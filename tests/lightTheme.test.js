import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8')

describe('Microsoft 참조 기반 화이트 테마', () => {
  it('문서, 초기 로딩과 전역 CSS가 같은 밝은 배경으로 시작한다', () => {
    const html = read('index.html')
    const css = read('src', 'index.css')

    expect(html).toContain('<html lang="ko" data-theme="light">')
    expect(html).toMatch(/name="theme-color"\s+content="#ffffff"/)
    expect(html).toMatch(/--boot-bg:\s*#ffffff;/)
    expect(html).toMatch(/color-scheme:\s*light/)
    expect(css).toMatch(/color-scheme:\s*light/)
    expect(css).toMatch(/--bg:\s*#ffffff;/)
    expect(css).toMatch(/--surface:\s*#ffffff;/)
    expect(css).toMatch(/--surface-alt:\s*#f5f5f5;/)
    expect(html).not.toMatch(/data-theme="dark"|color-scheme:\s*dark/)
    expect(css).not.toMatch(/color-scheme:\s*dark|\[data-theme=['"]dark['"]\]/)
  })

  it('사용자가 요청하지 않은 자동 테마 전환을 추가하지 않는다', () => {
    const main = read('src', 'main.jsx')
    const app = read('src', 'App.jsx')

    expect(main).not.toContain('ThemeProvider')
    expect(app).not.toContain('ThemeToggle')
    expect(main).not.toContain('prefers-color-scheme')
  })
})
