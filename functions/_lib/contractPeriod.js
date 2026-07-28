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

// 근로기준법 제42조: 근로계약서 등 근로관계 서류는 3년간 보존해야 한다.
export const RETENTION_YEARS = 3
// 갱신 사이 공백이 이보다 길면 계속근로가 끊겼을 수 있다고 본다.
export const CONTINUITY_GAP_DAYS = 30

// 계약서 보존 의무 기간. 기산일은 근로관계가 끝난 날(계약 종료일),
// 종료일이 없으면 서명일로 잡는다.
export function describeRetention(terms, signedAt, now = new Date()) {
  const base = parseContractDate(terms?.contractEndDate) || parseContractDate(signedAt)
  if (!base) return { known: false }

  const until = new Date(
    Date.UTC(base.getUTCFullYear() + RETENTION_YEARS, base.getUTCMonth(), base.getUTCDate())
  )
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const remainingDays = daysBetween(today, until)

  return {
    known: true,
    basis: base.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    remainingDays,
    expired: remainingDays < 0,
    label: remainingDays < 0 ? '보존 의무 기간 종료' : `보존 만료 ${remainingDays}일 전`,
    detail:
      remainingDays < 0
        ? `근로기준법 제42조에 따른 3년 보존 의무 기간(${until.toISOString().slice(0, 10)})이 지났습니다.`
        : `근로기준법 제42조에 따라 ${until.toISOString().slice(0, 10)}까지 보존해야 합니다.`,
  }
}

// 이어진 계약들의 계속근로기간을 합산한다.
// segments는 오래된 순 [{roomId, title, startDate, endDate}].
export function describeContinuousEmployment(segments, now = new Date()) {
  const parsed = (segments || [])
    .map((s) => ({
      roomId: s.roomId,
      title: s.title,
      start: parseContractDate(s.startDate),
      end: parseContractDate(s.endDate),
    }))
    .filter((s) => s.start)

  if (parsed.length < 2) return { linked: false, count: parsed.length }

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  let totalMonths = 0
  const gaps = []

  parsed.forEach((s, i) => {
    // 진행 중인 마지막 계약은 종료일이 없으면 오늘까지로 센다.
    const end = s.end || (i === parsed.length - 1 ? today : null)
    // 종료일도 일한 날이다. "3월 1일 ~ 이듬해 2월 28일"은 11개월이 아니라 1년이므로
    // 하루를 더해 센다. 계속근로기간은 실제로 일한 기간이어야 한다.
    if (end) totalMonths += Math.max(0, monthsBetween(s.start, new Date(end.getTime() + DAY_MS)) ?? 0)

    const next = parsed[i + 1]
    if (next && s.end) {
      const gap = daysBetween(s.end, next.start)
      if (gap > CONTINUITY_GAP_DAYS) {
        gaps.push({ afterRoomId: s.roomId, days: gap })
      }
    }
  })

  const first = parsed[0]
  const last = parsed[parsed.length - 1]

  return {
    linked: true,
    count: parsed.length,
    totalMonths,
    startDate: first.start.toISOString().slice(0, 10),
    endDate: (last.end || null)?.toISOString().slice(0, 10) ?? null,
    exceedsFixedTermLimit: totalMonths > FIXED_TERM_LIMIT_MONTHS,
    gaps,
    segments: parsed.map((s) => ({
      roomId: s.roomId,
      title: s.title,
      startDate: s.start.toISOString().slice(0, 10),
      endDate: s.end ? s.end.toISOString().slice(0, 10) : null,
    })),
  }
}

// 이어진 계약을 합산했을 때만 드러나는 경고.
export function checkContinuityCompliance(continuity) {
  if (!continuity?.linked || !continuity.exceedsFixedTermLimit) return []
  const gapNote =
    continuity.gaps.length > 0
      ? ' 다만 계약 사이에 공백이 있어 계속근로로 볼지는 실제 근무 여부에 따라 달라질 수 있습니다.'
      : ''
  return [
    {
      severity: 'high',
      title: '계속근로 2년 초과',
      detail: `이어진 계약 ${continuity.count}건의 계속근로기간이 약 ${continuity.totalMonths}개월로 2년을 넘습니다. 기간제법 제4조에 따라 2년을 초과해 사용한 기간제근로자는 기간의 정함이 없는 근로계약을 체결한 것으로 봅니다.${gapNote}`,
    },
  ]
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
