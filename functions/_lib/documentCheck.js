// 계약서 "본문" 점검 (순수 함수 — 단위 테스트 대상).
//
// 지금까지의 서명 전 점검은 구조화된 계약 조건(필드)만 봤다. 그런데 사람이
// 실제로 읽고 서명하고 PDF로 보관하는 것은 AI가 쓴 계약서 본문이다. 조건을
// 수정해도 본문은 예전 그대로 남기 때문에, 필드에는 250만원이 적혀 있는데
// 본문에는 320만원이 인쇄된 계약서에 양측이 서명할 수 있었다.
//
// 여기서 본문을 조건과 대조하고(정합성), 표준근로계약서에 반드시 있어야 할
// 조항이 본문에 실제로 담겨 있는지 확인한다(필수 조항).

import { FIELD_LABELS } from './contractCheck.js'

// 비교용으로 공백·쉼표·가운뎃점을 없앤다. "3,200,000 원" → "3200000원"
function strip(text) {
  return String(text ?? '').replace(/[\s,·]/g, '')
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 숫자로 시작/끝나는 토큰은 앞뒤에 다른 숫자가 붙지 않을 때만 일치로 본다.
// "9시"가 "19시"에 걸리거나 "3200000"이 "13200000"에 걸리는 것을 막는다.
export function containsToken(text, token) {
  if (!token) return false
  const pre = /^\d/.test(token) ? '(?<!\\d)' : ''
  const post = /\d$/.test(token) ? '(?!\\d)' : ''
  return new RegExp(`${pre}${escapeRegExp(token)}${post}`).test(text)
}

// 3200000 → ['3200000', '320만']  (본문이 "320만원"으로 써도 인정)
export function amountVariants(value) {
  const n = Number(String(value).replace(/[,\s원]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return []
  const out = [String(n)]
  if (n % 10000 === 0) out.push(`${n / 10000}만`)
  return out
}

// '2026-09-01' → 2026년9월1일 / 2026.09.01 / 2026/9/1 등 표기 변형
export function dateVariants(value) {
  const m = String(value ?? '').match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/)
  if (!m) return []
  const [, y, rawM, rawD] = m
  const mm = rawM.padStart(2, '0')
  const dd = rawD.padStart(2, '0')
  const mo = String(Number(rawM))
  const da = String(Number(rawD))
  return [
    `${y}-${mm}-${dd}`,
    `${y}년${mo}월${da}일`,
    `${y}년${mm}월${dd}일`,
    `${y}.${mm}.${dd}`,
    `${y}.${mo}.${da}`,
    `${y}/${mm}/${dd}`,
    `${y}/${mo}/${da}`,
  ]
}

// '09:00' → 09:00 / 9:00 / 9시 / 오전9시
export function timeVariants(value) {
  const m = String(value ?? '').match(/^(\d{1,2})\s*[:시]\s*(\d{1,2})?/)
  if (!m) return []
  const h = Number(m[1])
  const min = Number(m[2] || 0)
  if (!Number.isFinite(h) || h < 0 || h > 24) return []
  const hh = String(h).padStart(2, '0')
  const mmin = String(min).padStart(2, '0')
  const out = [`${hh}:${mmin}`, `${h}:${mmin}`]
  if (min === 0) {
    out.push(`${h}시`, `${hh}시`)
    if (h > 12) out.push(`오후${h - 12}시`)
    else if (h > 0 && h < 12) out.push(`오전${h}시`)
  }
  return out
}

// 본문에서 반드시 값이 그대로 살아 있어야 하는 항목.
// 업무 내용·연차처럼 AI가 문장으로 풀어 쓰는 항목은 값 대조 대상에서 빼고,
// 아래 필수 조항 점검이 대신 담당한다.
const VERIFIED_FIELDS = [
  { field: 'wageBaseAmount', kind: 'amount', severity: 'high' },
  { field: 'contractStartDate', kind: 'date', severity: 'high' },
  { field: 'contractEndDate', kind: 'date', severity: 'high' },
  { field: 'workHoursStart', kind: 'time', severity: 'high' },
  { field: 'workHoursEnd', kind: 'time', severity: 'high' },
  { field: 'employerName', kind: 'text', severity: 'medium' },
  { field: 'employeeName', kind: 'text', severity: 'medium' },
  { field: 'workLocation', kind: 'text', severity: 'medium' },
  { field: 'wagePayDate', kind: 'text', severity: 'medium' },
]

function variantsFor(kind, value) {
  if (kind === 'amount') return amountVariants(value)
  if (kind === 'date') return dateVariants(value)
  if (kind === 'time') return timeVariants(value)
  const text = strip(value)
  return text ? [text] : []
}

// 본문의 임금 조항에서 "기본급 ○○원"을 뽑아낸다.
// 식대·수당 같은 다른 금액을 잘못 집지 않도록 기본급/월급 표현 바로 뒤만 본다.
export function findStatedBaseWage(strippedText) {
  const m = strippedText.match(/(?:기본급|월급여|월급|월정액|임금은)[^。.\n]{0,20}?(\d[\d]{4,}|\d{1,5}만)원/)
  if (!m) return null
  const token = m[1]
  const value = token.endsWith('만') ? Number(token.slice(0, -1)) * 10000 : Number(token)
  return Number.isFinite(value) && value > 0 ? value : null
}

// 계약 조건 ↔ 계약서 본문 대조.
// articles: [{heading, body}] (AI가 작성한 본문), terms: 카멜 표기 계약 조건
export function checkDocumentConsistency(articles, terms) {
  if (!Array.isArray(articles) || articles.length === 0 || !terms) return []

  const stripped = strip(articles.map((a) => `${a?.heading ?? ''} ${a?.body ?? ''}`).join('\n'))
  const issues = []

  for (const { field, kind, severity } of VERIFIED_FIELDS) {
    const value = terms[field]
    if (value === null || value === undefined || String(value).trim() === '') continue

    const variants = variantsFor(kind, value)
    if (variants.length === 0) continue
    if (variants.some((v) => containsToken(stripped, v))) continue

    const label = FIELD_LABELS[field] || field
    const shown = kind === 'amount' ? `${Number(value).toLocaleString('ko-KR')}원` : String(value)

    // 기본급은 본문에 적힌 값을 함께 찾아서 보여준다. 서로 다른 금액이
    // 명확히 확인되면 그것만으로 서명을 막을 근거가 된다.
    if (field === 'wageBaseAmount') {
      const stated = findStatedBaseWage(stripped)
      if (stated !== null) {
        issues.push({
          field,
          label,
          severity: 'high',
          conflict: true,
          expected: shown,
          stated: `${stated.toLocaleString('ko-KR')}원`,
          message: `계약 조건의 기본급은 ${shown}인데, 계약서 본문에는 ${stated.toLocaleString('ko-KR')}원으로 적혀 있습니다. 서명하는 문서는 본문이므로 반드시 다시 작성해야 합니다.`,
        })
        continue
      }
    }

    issues.push({
      field,
      label,
      severity,
      conflict: false,
      expected: shown,
      stated: null,
      message: `계약 조건의 ${label}(${shown})이(가) 계약서 본문에서 확인되지 않습니다. 조건을 수정한 뒤 본문을 다시 작성하지 않았을 수 있습니다.`,
    })
  }

  return issues
}

// 근로기준법 제17조 명시사항 — 본문에 조항으로 담겨 있어야 한다.
export const REQUIRED_TOPICS = [
  { key: 'period', label: '근로계약기간', keywords: ['근로계약기간', '계약기간', '근로개시일'] },
  { key: 'workplace', label: '취업의 장소', keywords: ['근무장소', '취업장소', '근무지', '취업의장소'] },
  { key: 'job', label: '종사할 업무', keywords: ['업무의내용', '담당업무', '종사할업무', '직무'] },
  { key: 'hours', label: '소정근로시간', keywords: ['소정근로시간', '근로시간', '근무시간'] },
  { key: 'holiday', label: '휴일', keywords: ['휴일', '주휴'] },
  { key: 'wage', label: '임금의 구성·계산·지급방법', keywords: ['임금', '기본급', '급여', '보수'] },
  { key: 'leave', label: '연차유급휴가', keywords: ['연차', '유급휴가'] },
]

// 본문에서 빠진 필수 조항. [{key, label, message}]
export function checkRequiredArticles(articles) {
  if (!Array.isArray(articles) || articles.length === 0) return []
  const stripped = strip(articles.map((a) => `${a?.heading ?? ''} ${a?.body ?? ''}`).join('\n'))
  return REQUIRED_TOPICS.filter((t) => !t.keywords.some((k) => stripped.includes(k))).map((t) => ({
    key: t.key,
    label: t.label,
    message: `계약서 본문에 ${t.label}에 관한 내용이 보이지 않습니다. (근로기준법 제17조 명시사항)`,
  }))
}

// 본문 점검 전체. AI 본문이 없으면 조건에서 바로 조항을 만들어 쓰므로 점검 대상이 아니다.
export function checkContractDocument(terms) {
  const articles = terms?.aiDocument
  if (!Array.isArray(articles) || articles.length === 0) {
    return { hasDocument: false, issues: [], missingArticles: [], hasConflict: false }
  }
  const issues = checkDocumentConsistency(articles, terms)
  return {
    hasDocument: true,
    issues,
    missingArticles: checkRequiredArticles(articles),
    hasConflict: issues.some((i) => i.conflict),
  }
}
