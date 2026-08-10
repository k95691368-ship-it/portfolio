// 아직 계약서가 아닌 것을 계약서처럼 점검한다 (순수 함수 — 단위 테스트 대상).
//
// 법령 점검은 지금까지 계약서에 값이 다 채워진 뒤라야 돌 수 있었다. 그런데
// 조건은 계약서에 적히기 훨씬 전에 대화에서 정해진다. 그 사이에 문제를 잡지
// 못하면, 확정된 뒤에 고쳐야 하고 — 확정 뒤의 불리한 변경은 이 앱이 막으려는
// 실질적 취소다.
//
// 대화에서 모은 협의 이력의 항목별 최신값을 계약 조건 모양으로 세워, 같은
// 계산을 미리 돌린다.
//
// 다만 계약서와 다르게 다뤄야 하는 것이 하나 있다. 계약서에서 비어 있는 항목은
// "누락"이지만, 협의 중에 비어 있는 항목은 "아직 정하지 않음"이다. 아직 정하지
// 않은 것을 위반으로 세면 협의 초반에는 화면이 붉은 경고로 가득 차고, 그러면
// 진짜 경고까지 함께 무시된다.

import { checkLegalCompliance, findMissingFields } from './contractCheck.js'
import { checkPeriodCompliance } from './contractPeriod.js'
import { checkProbationCompliance } from './probation.js'
import { comparePostingToContract } from './postingMatch.js'

// 협의 이력의 항목별 마지막 값을 계약 조건 모양으로 세운다.
//
// 계약서에 이미 저장된 값이 있으면 그것을 바닥에 깔고, 대화에서 나중에 정해진
// 값으로 덮는다. 계약서를 아직 쓰지 않은 방에서도 점검이 돌아야 한다.
export function termsFromNegotiation(rows, savedTerms = null) {
  const terms = { ...(savedTerms || {}) }

  for (const r of rows || []) {
    const field = r.field
    const value = r.value
    if (!field || value === null || value === undefined || value === '') continue

    if (field === 'workHours') {
      // 협의 이력은 "09:00~18:00" 한 덩어리로 남지만, 계산은 시작·종료를
      // 따로 본다.
      const [start, end] = String(value).split('~')
      if (start) terms.workHoursStart = start
      if (end) terms.workHoursEnd = end
      continue
    }
    if (field === 'wageBaseAmount') {
      const n = Number(value)
      if (Number.isFinite(n) && n > 0) terms.wageBaseAmount = n
      continue
    }
    terms[field] = value
  }

  return terms
}

// 계약서에 반드시 있어야 하는데 아직 대화에서 정해지지 않은 것.
//
// findMissingFields 와 같은 목록을 쓰되, 부르는 이름을 바꾼다. 협의 중에는
// 비어 있는 것이 잘못이 아니라 아직 남은 일이다.
export function pendingAgreements(terms) {
  return findMissingFields(terms || {}).map((m) => ({
    field: m.field,
    label: m.label,
    note: m.note ?? null,
    unreadable: !!m.unreadable,
  }))
}

// 지금 합의된 값대로 계약하면 무엇이 걸리는가.
//
// 계약서 점검과 같은 함수를 쓴다. 여기서만 다른 규칙을 쓰면 "협의 때는
// 괜찮다더니 계약서에서는 막힌다"가 되어, 두 화면 중 하나는 반드시 거짓말이
// 된다.
export function checkNegotiatedTerms(terms, postingRow = null) {
  const t = terms || {}

  const issues = [
    ...checkLegalCompliance(t),
    ...checkPeriodCompliance(t),
    ...checkProbationCompliance(t),
  ]

  const posting = postingRow
    ? {
        wageType: postingRow.wage_type ?? postingRow.wageType,
        wageMin: postingRow.wage_min ?? postingRow.wageMin,
        wageMax: postingRow.wage_max ?? postingRow.wageMax,
        workHoursStart: postingRow.work_hours_start ?? postingRow.workHoursStart,
        workHoursEnd: postingRow.work_hours_end ?? postingRow.workHoursEnd,
        workDays: postingRow.work_days ?? postingRow.workDays,
        employmentType: postingRow.employment_type ?? postingRow.employmentType,
        location: postingRow.location,
      }
    : null
  const postingComparison = posting ? comparePostingToContract(posting, t) : null

  const pending = pendingAgreements(t)

  return {
    issues,
    pending,
    postingComparison,
    // 지금 계약서를 써도 되는가. 위법 소지가 있거나 필수 항목이 안 정해졌으면
    // 아직이다.
    ready: issues.every((i) => i.severity !== 'high') && pending.length === 0,
    counts: {
      high: issues.filter((i) => i.severity === 'high').length,
      medium: issues.filter((i) => i.severity === 'medium').length,
      pending: pending.length,
    },
  }
}
