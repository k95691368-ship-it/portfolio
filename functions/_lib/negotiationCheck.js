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
//
// 다만 누가 말했는지를 보지 않고 있었다. 그래서 지원자가 "저는 월 400만원을
// 희망합니다"라고 말하기만 하면 회사가 저장해 둔 290만원이 그 값으로 덮이고,
// 최저임금 미달 여부를 아무도 제안하지 않은 금액으로 판정했다. 협의는 두
// 사람이 서로 다른 값을 말하는 자리라, 발화자를 지우면 그 자리가 사라진다.
//
// 조건을 정하는 것은 회사다. 지원자의 발언은 덮지 않고 따로 모아 "양측이
// 다르게 말한 항목"으로 돌려준다.
export function termsFromNegotiation(rows, savedTerms = null) {
  const terms = { ...(savedTerms || {}) }

  for (const r of rows || []) {
    const field = r.field
    const value = r.value
    if (!field || value === null || value === undefined || value === '') continue

    // 지원자가 말한 값은 판정에 넣지 않는다. 조건을 정하는 것은 회사이고,
    // 지원자의 발언은 아래 candidateRequests 가 따로 모아 보여 준다.
    const role = r.speaker_role ?? r.role ?? null
    if (role === 'candidate') continue

    if (field === 'workHours') {
      // 협의 이력은 "09:00~18:00" 한 덩어리로 남지만, 계산은 시작·종료를
      // 따로 본다.
      //
      // 한쪽만 세우면 안 된다. 시작만 있고 종료가 없으면 주 근로시간이
      // 계산되지 않는데, 계약서에는 시각이 적혀 있는 것처럼 보여 필수 항목
      // 검사를 통과한다 — 값은 있는데 계산은 꺼지는, 이 저장소에서 반복되는
      // 모양이다.
      const [start, end, ...rest] = String(value).split('~')
      if (rest.length > 0) continue
      if (!start?.trim() || !end?.trim()) continue
      terms.workHoursStart = start.trim()
      terms.workHoursEnd = end.trim()
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

// 지원자가 말했는데 회사 쪽 값과 다른 것.
//
// 판정에서 뺐다고 없던 말이 되는 것은 아니다. 오히려 이것이 계약서를 쓰기
// 전에 봐야 하는 것이다 — 양측이 서로 다른 값을 말한 채로 계약서에 들어가면,
// 나중에 "그렇게 합의한 적 없다"가 되고 그 다툼에는 근거가 없다.
export function candidateRequests(rows, terms) {
  const t = terms || {}
  const latest = new Map()

  for (const r of rows || []) {
    const role = r.speaker_role ?? r.role ?? null
    if (role !== 'candidate') continue
    const field = r.field
    const value = r.value
    if (!field || value === null || value === undefined || value === '') continue

    // 회사 쪽 값과 같으면 이견이 아니라 합의다.
    const theirs =
      field === 'workHours'
        ? t.workHoursStart && t.workHoursEnd
          ? `${t.workHoursStart}~${t.workHoursEnd}`
          : null
        : t[field] === null || t[field] === undefined
          ? null
          : String(t[field])
    if (theirs !== null && theirs === String(value)) {
      latest.delete(field)
      continue
    }

    latest.set(field, {
      field,
      label: r.label ?? field,
      requested: r.value_display ?? r.display ?? String(value),
      current: theirs,
      excerpt: r.excerpt ?? null,
      at: r.created_at ?? r.at ?? null,
    })
  }

  return [...latest.values()]
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

  // 공고와 어긋난 것도 위법이다 — 채용절차법 제4조 제3항.
  //
  // 스스로 계산해 놓고 판정에서 빼고 있었다. 공고보다 임금이 낮아 high 경고가
  // 떠 있는데도 '계약서를 써도 됩니다'가 함께 표시됐다. 화면에 경고와 통과가
  // 나란히 있으면 사람은 통과를 읽는다.
  const postingIssues = postingComparison?.issues ?? []

  return {
    issues,
    pending,
    postingComparison,
    // 지금 계약서를 써도 되는가. 위법 소지가 있거나 필수 항목이 안 정해졌으면
    // 아직이다.
    ready:
      issues.every((i) => i.severity !== 'high') &&
      postingIssues.every((i) => i.severity !== 'high') &&
      pending.length === 0,
    counts: {
      high:
        issues.filter((i) => i.severity === 'high').length +
        postingIssues.filter((i) => i.severity === 'high').length,
      medium:
        issues.filter((i) => i.severity === 'medium').length +
        postingIssues.filter((i) => i.severity === 'medium').length,
      pending: pending.length,
    },
  }
}
