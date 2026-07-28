// 근로계약 기간 계산 (순수 함수 — 단위 테스트 대상).
//
// 지금까지 이 서비스는 계약을 "체결"하면 끝이었다. 그런데 근로계약의 수명은
// 그때부터 시작한다. 기간제 계약은 만료되고, 만료 전에 갱신 여부를 알려야 하며,
// 2년을 넘기면 법적으로 성격이 바뀐다.
//
// 기간제 및 단시간근로자 보호 등에 관한 법률 제4조:
// 사용자는 2년을 초과하지 않는 범위에서 기간제근로자를 사용할 수 있고,
// 2년을 초과해 사용하면 기간의 정함이 없는 근로계약을 체결한 것으로 본다.

const DAY_MS = 24 * 60 * 60 * 1000
export const FIXED_TERM_LIMIT_MONTHS = 24 // 기간제 상한 (2년)
export const EXPIRY_SOON_DAYS = 30 // 만료 임박으로 볼 기간

// "2026-09-01", "2026년 9월 1일", "2026.9.1", "2026/09/01" → Date (UTC 자정)
export function parseContractDate(value) {
  if (!value) return null
  const m = String(value).match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/)
  if (!m) return null
  const [, y, mo, d] = m.map(Number)
  const date = new Date(Date.UTC(y, mo - 1, d))
  // 2월 30일 같은 값이 다른 달로 넘어가면 잘못된 날짜다.
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date
}

// 시작일~종료일이 몇 개월인지 (일수 차이를 개월로 환산하지 않고 달력 기준).
export function monthsBetween(start, end) {
  if (!start || !end) return null
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12
  months += end.getUTCMonth() - start.getUTCMonth()
  // 종료일이 시작일보다 앞선 날짜면 아직 한 달이 안 찬 것으로 본다.
  if (end.getUTCDate() < start.getUTCDate()) months -= 1
  return months
}

function daysBetween(from, to) {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

// 계약 기간 상태. 날짜를 알 수 없으면 known:false 로 돌려준다.
export function describeContractPeriod(terms, now = new Date()) {
  const start = parseContractDate(terms?.contractStartDate)
  const end = parseContractDate(terms?.contractEndDate)
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  if (!start && !end) {
    return { known: false, status: 'unknown', label: '계약 기간 미기재' }
  }

  // 종료일이 없으면 기간의 정함이 없는 근로계약(무기계약)이다.
  if (start && !end) {
    return {
      known: true,
      openEnded: true,
      status: 'open_ended',
      label: '기간의 정함 없음',
      startDate: start.toISOString().slice(0, 10),
      detail: '종료일이 없어 기간의 정함이 없는 근로계약으로 봅니다.',
    }
  }

  const months = start ? monthsBetween(start, end) : null
  const remainingDays = daysBetween(today, end)
  const exceedsFixedTermLimit = months !== null && months > FIXED_TERM_LIMIT_MONTHS

  let status
  let label
  if (remainingDays < 0) {
    status = 'expired'
    label = '계약 만료'
  } else if (start && today < start) {
    status = 'scheduled'
    label = '개시 예정'
  } else if (remainingDays <= EXPIRY_SOON_DAYS) {
    status = 'expiring_soon'
    label = `만료 ${remainingDays}일 전`
  } else {
    status = 'active'
    label = '계약 진행 중'
  }

  return {
    known: true,
    openEnded: false,
    status,
    label,
    startDate: start ? start.toISOString().slice(0, 10) : null,
    endDate: end.toISOString().slice(0, 10),
    months,
    remainingDays,
    exceedsFixedTermLimit,
  }
}

// 서명 전 점검에 함께 실을 기간 관련 경고.
export function checkPeriodCompliance(terms, now = new Date()) {
  const issues = []
  const period = describeContractPeriod(terms, now)
  if (!period.known || period.openEnded) return issues

  if (period.exceedsFixedTermLimit) {
    issues.push({
      severity: 'medium',
      title: '기간제 2년 초과',
      detail: `계약 기간이 약 ${period.months}개월로 2년을 초과합니다. 기간제법 제4조에 따라 2년을 초과해 사용하면 기간의 정함이 없는 근로계약을 체결한 것으로 보게 되므로, 계약 형태를 다시 확인해주세요.`,
    })
  }

  const start = parseContractDate(terms?.contractStartDate)
  const end = parseContractDate(terms?.contractEndDate)
  if (start && end && end.getTime() < start.getTime()) {
    issues.push({
      severity: 'high',
      title: '계약 기간 오류',
      detail: '근로계약 종료일이 근로개시일보다 앞섭니다. 날짜를 확인해주세요.',
    })
  }

  return issues
}
