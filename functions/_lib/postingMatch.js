// 채용 공고의 조건과 실제 계약 조건을 대조한다 (순수 함수 — 단위 테스트 대상).
//
// 공고를 보고 지원한 사람은 그 조건을 전제로 결정했다. 그런데 계약서를 받는
// 시점에 조건이 나빠져 있어도 앱은 아무것도 알려주지 않았다. 비교할 값이
// 공고에 구조화돼 있지 않았기 때문이다.
//
// 채용절차의 공정화에 관한 법률 제4조 제3항은 구인자가 채용광고에서 제시한
// 근로조건을 구직자에게 불리하게 변경하는 것을 금지한다. 이 대조는 그 조항이
// 말하는 "불리하게 변경"을 값으로 확인한다.
//
// AI를 쓰지 않는다. 임금이 줄었는지 근로시간이 늘었는지는 숫자를 견주면 되고,
// 그 판단은 매번 같아야 한다.

import { computeWeeklyHours, monthlyPaidHours, parseDaysPerWeek } from './contractCheck.js'

const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`

const WAGE_TYPE_LABELS = {
  monthly: '월급',
  hourly: '시급',
  annual: '연봉',
}

export function wageTypeLabel(type) {
  return WAGE_TYPE_LABELS[type] || type
}

// 공고에 적힌 임금을 계약서와 견줄 수 있는 월 금액으로 바꾼다.
// 시급은 계약서의 근로시간을 알아야 환산할 수 있으므로, 알 수 없으면 null을
// 돌려 "비교할 수 없음"으로 남긴다 — 추측해서 경고하지 않는다.
export function postingWageToMonthly(posting, terms) {
  const min = Number(posting?.wageMin)
  if (!Number.isFinite(min) || min <= 0) return null

  if (posting.wageType === 'monthly') return { monthly: min, basis: '공고의 월급 하한' }
  if (posting.wageType === 'annual') {
    return { monthly: min / 12, basis: `공고의 연봉 하한 ${won(min)} ÷ 12개월` }
  }
  if (posting.wageType === 'hourly') {
    const weekly = computeWeeklyHours(terms)
    if (weekly === null) return null
    const hours = monthlyPaidHours(weekly)
    if (!(hours > 0)) return null
    return {
      monthly: min * hours,
      basis: `공고의 시급 하한 ${won(min)} × 월 소정근로시간 약 ${Math.round(hours)}시간`,
    }
  }
  return null
}

function issue(field, label, severity, message) {
  return { field, label, severity, message }
}

// posting: { wageType, wageMin, wageMax, workHoursStart, workHoursEnd, workDays,
//            employmentType, location }
// terms: 카멜 표기 계약 조건
export function comparePostingToContract(posting, terms) {
  if (!posting || !terms) return { comparable: false, issues: [], matched: [] }

  const issues = []
  const matched = []
  let comparedAnything = false

  // 임금 — 공고가 약속한 하한보다 낮으면 불리한 변경이다.
  const promised = postingWageToMonthly(posting, terms)
  const actual = Number(terms.wageBaseAmount)
  if (promised && Number.isFinite(actual) && actual > 0) {
    comparedAnything = true
    if (actual < promised.monthly) {
      issues.push(
        issue(
          'wageBaseAmount',
          '임금',
          'high',
          `공고에는 ${wageTypeLabel(posting.wageType)} 최소 ${won(posting.wageMin)}으로 제시됐는데(${promised.basis} = 월 ${won(promised.monthly)}), 계약서의 기본급은 월 ${won(actual)}입니다. 월 ${won(promised.monthly - actual)} 적습니다.`
        )
      )
    } else {
      matched.push(
        issue('wageBaseAmount', '임금', 'ok', `공고에 제시된 최소 금액(월 ${won(promised.monthly)}) 이상입니다.`)
      )
    }
  }

  // 근로시간 — 공고보다 길어지면 불리한 변경이다.
  const promisedWeekly = computeWeeklyHours({
    workHoursStart: posting.workHoursStart,
    workHoursEnd: posting.workHoursEnd,
    workDays: posting.workDays,
  })
  const actualWeekly = computeWeeklyHours(terms)
  if (promisedWeekly !== null && actualWeekly !== null) {
    comparedAnything = true
    if (actualWeekly > promisedWeekly) {
      issues.push(
        issue(
          'workHours',
          '근로시간',
          'high',
          `공고 기준 주 ${promisedWeekly}시간인데 계약서는 주 ${actualWeekly}시간입니다. 주 ${Math.round((actualWeekly - promisedWeekly) * 10) / 10}시간 늘었습니다.`
        )
      )
    } else {
      matched.push(issue('workHours', '근로시간', 'ok', `공고 기준(주 ${promisedWeekly}시간)을 넘지 않습니다.`))
    }
  }

  // 근무일 수 — 늘어나면 불리하다.
  const promisedDays = parseDaysPerWeek(posting.workDays)
  const actualDays = parseDaysPerWeek(terms.workDays)
  if (promisedDays !== null && actualDays !== null) {
    comparedAnything = true
    if (actualDays > promisedDays) {
      issues.push(
        issue(
          'workDays',
          '근무일',
          'medium',
          `공고에는 주 ${promisedDays}일로 제시됐는데 계약서는 주 ${actualDays}일입니다.`
        )
      )
    }
  }

  // 고용형태 — 공고가 기간의 정함이 없는 자리로 보였는데 기간제 계약이면 불리하다.
  const openEndedPosting = /정규직|무기/.test(String(posting.employmentType || ''))
  if (openEndedPosting) {
    comparedAnything = true
    if (terms.contractEndDate) {
      issues.push(
        issue(
          'employmentType',
          '고용형태',
          'high',
          `공고에는 "${posting.employmentType}"으로 제시됐는데 계약서에는 종료일(${terms.contractEndDate})이 있는 기간제 계약입니다.`
        )
      )
    } else {
      matched.push(issue('employmentType', '고용형태', 'ok', '공고와 같이 기간의 정함이 없는 계약입니다.'))
    }
  }

  // 근무지 — 유리·불리를 코드가 판단할 수 없으므로 달라졌다는 사실만 알린다.
  const promisedLocation = String(posting.location || '').trim()
  const actualLocation = String(terms.workLocation || '').trim()
  if (promisedLocation && actualLocation) {
    comparedAnything = true
    const same =
      promisedLocation === actualLocation ||
      actualLocation.includes(promisedLocation) ||
      promisedLocation.includes(actualLocation)
    if (!same) {
      issues.push(
        issue(
          'workLocation',
          '근무지',
          'medium',
          `공고에는 "${promisedLocation}", 계약서에는 "${actualLocation}"으로 적혀 있습니다. 출퇴근 조건이 달라질 수 있으니 확인해보세요.`
        )
      )
    } else {
      matched.push(issue('workLocation', '근무지', 'ok', '공고와 같습니다.'))
    }
  }

  return {
    comparable: comparedAnything,
    issues,
    matched,
    hasUnfavorable: issues.some((i) => i.severity === 'high'),
    summary: !comparedAnything
      ? '공고에 구조화된 근로조건이 없어 계약서와 대조할 수 없습니다.'
      : issues.length === 0
        ? '공고에 제시된 조건과 계약서가 어긋나지 않습니다.'
        : `공고와 다른 항목이 ${issues.length}가지 있습니다. 채용절차법 제4조 제3항은 채용광고에 제시한 근로조건을 구직자에게 불리하게 변경하는 것을 금지합니다.`,
  }
}
