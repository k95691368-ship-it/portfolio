import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// 서명 그리기 라이브러리(약 15KB)는 서명 창을 여는 사람만 쓴다. 정적으로 import 하면
// 계약서를 보기만 하는 사람의 첫 묶음에도 붙는다.
it('서명 패드는 그리기 라이브러리를 필요할 때 불러오고, 그 전에도 흰 배경을 칠한다', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'components', 'SignaturePad.jsx'), 'utf8')
  expect(source).not.toMatch(/^import[^\n]*['"]signature_pad['"]/m)
  expect(source).toContain("import('signature_pad')")
  // 라이브러리 준비 전의 지우기·크기 조정도 저장 PNG 와 같은 배경을 칠해야 한다.
  expect(source).toMatch(/fillStyle = BACKGROUND/)
  expect(source).not.toMatch(/padRef\.current\?\.clear\(\)/)
})
