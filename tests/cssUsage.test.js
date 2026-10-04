import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// 화면에서 사라진 기능의 스타일이 CSS 묶음에 남아 모든 방문자가 받지 않게 한다.
// 클래스 이름이 코드 어디에도 글자로 나오지 않으면 쓰이지 않는 규칙이다.
const ROOT = process.cwd()
const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])

// 코드가 `접두사-${값}`으로 조립하는 클래스들.
const DYNAMIC = [/^step-/, /^toast-/, /^chat-row-/]

it('CSS에 정의된 클래스는 모두 화면 코드에서 쓰인다', () => {
  const files = walk(join(ROOT, 'src'))
  const code = [
    ...files.filter((file) => /\.(jsx?|tsx?)$/.test(file) && !/\.test\./.test(file)),
    join(ROOT, 'index.html'), join(ROOT, 'privacy', 'index.html'), join(ROOT, 'terms', 'index.html'),
  ].map((file) => readFileSync(file, 'utf8')).join('\n')
  const words = new Set(code.match(/[A-Za-z0-9_-]+/g))
  const unused = files.filter((file) => file.endsWith('.css')).flatMap((file) => {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, '')
    const classes = new Set([...css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => match[1]))
    return [...classes].filter((name) => !words.has(name) && !DYNAMIC.some((pattern) => pattern.test(name)))
  })
  expect(unused).toEqual([])
})
