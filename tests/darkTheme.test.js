import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8')

describe('검은 테마 고정', () => {
  it('문서와 전역 CSS가 첫 화면부터 dark로 고정된다', () => {
    const html = read('index.html')
    const css = read('src', 'index.css')

    expect(html).toContain('<html lang="ko" data-theme="dark">')
    expect(css).toContain('color-scheme: dark')
    expect(css).toMatch(/--bg:\s*#000;/)
  })

  it('테마 전환 UI와 컨텍스트를 앱에 다시 연결하지 않는다', () => {
    const main = read('src', 'main.jsx')
    const app = read('src', 'App.jsx')

    expect(main).not.toContain('ThemeProvider')
    expect(app).not.toContain('ThemeToggle')
    expect(main).not.toContain('prefers-color-scheme')
  })
})
