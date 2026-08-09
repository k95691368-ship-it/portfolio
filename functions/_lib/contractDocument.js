// 서명 대상 문서를 한 가지 형태의 문자열로 만든다 (순수 함수 — 단위 테스트 대상).
//
// 전자서명이 "이 문서에 서명했다"를 뜻하려면 서명과 문서가 묶여 있어야 한다.
// 그런데 signatures 표에는 서명 그림과 접속 흔적만 있고 어떤 내용에 붙었는지가
// 없어서, 서명 데이터만으로는 무엇에 동의한 것인지 특정할 수 없었다. 유일한
// 해시는 서명이 다 끝난 뒤 회사가 올린 PDF 바이트에 대한 것이라 서명 행과
// 연결되지 않고 시점도 늦다.
//
// 그래서 서명 시점에 계약 내용을 정해진 순서로 직렬화해 지문을 만들고, 그 지문을
// 서명과 함께 남긴다. 같은 내용이면 항상 같은 지문이 나와야 하므로 키 순서·표기를
// 고정한다.

import { buildArticlesFromTerms } from './contract.js'

// 지문에 넣는 계약 조건. 순서를 코드로 고정해, 저장 순서나 객체 키 순서가
// 바뀌어도 같은 내용이면 같은 지문이 나오게 한다.
const TERM_ORDER = [
  'employerName',
  'employerAddress',
  'employeeName',
  'employeeAddress',
  'workLocation',
  'jobDescription',
  'contractStartDate',
  'contractEndDate',
  'workHoursStart',
  'workHoursEnd',
  'workDays',
  'restDays',
  'wageBaseAmount',
  'wagePayMethod',
  'wagePayDate',
  'annualLeave',
  // 계약서 입력에서는 내렸지만 정본 목록에서는 빼지 않는다. 빼면 줄이 하나
  // 사라져 이미 서명된 계약서의 지문이 소급해서 바뀐다. 값이 없는 계약에서는
  // 어차피 빈 문자열이라 출력이 달라지지 않는다.
  'uniformSize',
]

const INSURANCE_ORDER = [
  'employment_insurance',
  'health_insurance',
  'national_pension',
  'industrial_accident_insurance',
]

function value(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v).trim()
}

// 서명 대상의 정본 문자열. 사람이 읽을 수 있게 두어, 나중에 지문이 무엇에서
// 나왔는지 눈으로도 확인할 수 있게 한다.
export function canonicalizeContract(terms) {
  const lines = []

  lines.push('[계약조건]')
  for (const key of TERM_ORDER) {
    lines.push(`${key}=${value(terms?.[key])}`)
  }

  lines.push('[사회보험]')
  const insurance = terms?.socialInsurance
  for (const key of INSURANCE_ORDER) {
    lines.push(`${key}=${value(insurance && typeof insurance === 'object' ? insurance[key] : null)}`)
  }

  lines.push('[그밖의사항]')
  const custom = Array.isArray(terms?.customTerms) ? terms.customTerms : []
  // 입력 순서가 아니라 라벨 기준으로 정렬해, 같은 내용이면 같은 지문이 되게 한다.
  const sorted = [...custom]
    .map((c) => ({ label: value(c?.label), value: value(c?.value) }))
    .filter((c) => c.label !== '' || c.value !== '')
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))
  for (const c of sorted) lines.push(`${c.label}=${c.value}`)

  // 실제로 인쇄·서명되는 본문. AI 본문이 없으면 조건에서 만든 조항이 그대로
  // 인쇄되므로 같은 규칙으로 넣는다.
  lines.push('[본문]')
  const articles =
    Array.isArray(terms?.aiDocument) && terms.aiDocument.length > 0
      ? terms.aiDocument
      : buildArticlesFromTerms(terms)
  for (const a of articles) {
    lines.push(value(a?.heading))
    lines.push(value(a?.body))
  }

  return lines.join('\n')
}

// 정본 문자열의 SHA-256 지문 (16진). Workers·브라우저 모두에 있는 crypto.subtle을 쓴다.
export async function contractFingerprint(terms) {
  const text = canonicalizeContract(terms)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
