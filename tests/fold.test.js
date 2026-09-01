// 접어 둔 구획이 조용히 사라지지 않게 지킨다.
//
// 계약 화면은 한 장에 구획이 열다섯 개 쌓여 있었다. 서명하러 온 사람이
// 임금구성·해설·권리·대조·교부·기간·이력·번역·수정요청을 전부 지나야
// 서명 자리에 닿았다. 그래서 대부분을 접었다.
//
// 접기에는 두 가지 사고 방식이 있다.
//   1) 닫힌 줄에 아무 말이 없다 -> 사람이 안 열고, 그 내용은 없는 것이 된다.
//   2) 접으면 안 되는 것을 접는다 -> 서명·계약 조건까지 닫히면 화면이 빈다.
// 둘 다 화면을 열어 보기 전에는 안 보인다. 그래서 여기서 잡는다.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')

const FILES = [
  ['src', 'pages', 'ContractPage.jsx'],
  ['src', 'components', 'WorkerRights.jsx'],
  ['src', 'components', 'ContractExplainer.jsx'],
]

// <Fold ... > 한 덩이씩 뽑는다. 여는 태그가 끝나는 곳은 자식이 시작되기
// 직전이므로, 중첩 괄호를 세어 태그의 끝을 찾는다.
function foldTags(src) {
  const tags = []
  let i = 0
  while ((i = src.indexOf('<Fold', i)) >= 0) {
    let depth = 0
    let j = i
    for (; j < src.length; j += 1) {
      const c = src[j]
      if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      else if (c === '>' && depth === 0) break
    }
    tags.push(src.slice(i, j + 1))
    i = j + 1
  }
  return tags
}

describe('접힌 줄이 무엇이 들었는지 말하는가', () => {
  const all = FILES.flatMap(([...p]) => foldTags(read(...p)).map((t) => [p.at(-1), t]))

  it('접는 자리를 실제로 찾았다', () => {
    // 이 검사가 헛돌지 않게 개수를 못 박는다. 접기를 걷어내면 여기서 걸린다.
    expect(all.length).toBeGreaterThanOrEqual(9)
  })

  it('모든 접힌 줄에 개수나 상태가 적혀 있다', () => {
    for (const [file, tag] of all) {
      const title = tag.match(/title=(?:"([^"]+)"|\{[^}]*'([^']+)')/)
      const name = title?.[1] ?? title?.[2] ?? tag.slice(0, 40)
      expect(
        /\bhint=/.test(tag) || /\bbadge=/.test(tag),
        `${file} 의 「${name}」 이 닫힌 줄에 아무 말도 안 한다`,
      ).toBe(true)
    }
  })

  it('여는 태그와 닫는 태그 수가 맞는다', () => {
    for (const p of FILES) {
      const src = read(...p)
      const open = (src.match(/<Fold[\s>]/g) || []).length
      const close = (src.match(/<\/Fold>/g) || []).length
      expect(close, `${p.at(-1)}: 여는 ${open} 닫는 ${close}`).toBe(open)
    }
  })
})

describe('접으면 안 되는 것을 안 접었는가', () => {
  const page = read('src', 'pages', 'ContractPage.jsx')

  // 서명하러 온 사람이 하는 일은 둘뿐이다 — 조건을 보고, 서명한다.
  // 이 둘이 접히면 화면을 열었을 때 할 일이 안 보인다.
  it('서명 자리는 펼쳐져 있다', () => {
    expect(page).toContain('<section className="signature-section">')
  })

  it('계약 조건 자리는 펼쳐져 있다', () => {
    expect(page).toContain('<section className="contract-form">')
  })
})

describe('스스로 펼쳐져야 할 것이 펼쳐지는가', () => {
  const page = read('src', 'pages', 'ContractPage.jsx')
  const tags = foldTags(page)
  const find = (cls) => tags.find((t) => t.includes(`className="${cls}"`))

  it('공고보다 달라진 조건이 있으면 열린 채로 나온다', () => {
    // 그 사람은 공고를 보고 지원했다. 달라진 것을 모른 채 서명하면
    // 되돌릴 방법이 없다(채용절차법 제4조 제3항).
    expect(find('posting-compare')).toMatch(/defaultOpen=\{postingComparison\.issues\.length > 0\}/)
  })

  it('계약서를 아직 안 보냈으면 열린 채로 나온다', () => {
    // 교부는 근로기준법 제17조 제2항의 의무고 위반은 벌금 대상이다.
    expect(find('contract-delivery')).toMatch(/defaultOpen=\{!deliveryState\.delivered\}/)
  })

  it('답을 기다리는 수정 요청이 있으면 열린 채로 나온다', () => {
    expect(find('change-requests')).toMatch(/defaultOpen=\{pending\.length > 0\}/)
  })
})

describe('부품이 말 없는 접기를 거부하는가', () => {
  const fold = read('src', 'components', 'Fold.jsx')

  it('적을 말이 없으면 접지 않고 그냥 펼친 구획으로 그린다', () => {
    // 위 검사를 누가 지우더라도 부품 자체가 한 번 더 막는다.
    expect(fold).toContain('if (!label)')
    expect(fold).toMatch(/<section className=\{className\}>/)
  })

  it('말이 있을 때만 접는다', () => {
    expect(fold).toMatch(/const label = badge \?\? \(hint \?/)
  })
})
