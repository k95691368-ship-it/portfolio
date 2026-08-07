import { koreanToday } from './koreanTime.js'

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
export const FIXED_TERM_LIMIT_MONTHS = 24 // 기간제 상한 (2년) — 화면 표시용
// 여러 계약을 합산할 때 쓰는 일 단위 상한. 윤년을 포함하지 않는 2년(730일)을
// 기준으로 삼아, 애매한 경우 조금 이르게 알린다 — 법정 상한 경고는 늦게 뜨는
// 쪽이 위험하다.
export const FIXED_TERM_LIMIT_DAYS = 730
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

// 기간제 2년 상한은 "2년을 초과"라는 일 단위 기준이다.
//
// 이것을 달력 개월 내림(monthsBetween)으로 판정하면 사각지대가 생긴다.
// 2026-01-01 ~ 2028-01-31 계약은 2년 31일인데도 개월로는 24가 되어 경고가
// 나가지 않았다. 시작일 + 2년에 이르는 날부터는 2년을 넘긴 것이므로 그 날짜와
// 직접 견준다. months는 화면에 보여 주는 라벨로만 계속 쓴다.
function exceedsFixedTerm(start, end) {
  if (!start || !end) return false
  const years = FIXED_TERM_LIMIT_MONTHS / 12
  const limit = new Date(
    Date.UTC(start.getUTCFullYear() + years, start.getUTCMonth(), start.getUTCDate())
  )
  // 종료일까지 근무하므로, 종료일이 "시작일 + 2년" 당일이면 이미 2년 + 1일이다.
  return end.getTime() >= limit.getTime()
}

// 계약 기간 상태. 날짜를 알 수 없으면 known:false 로 돌려준다.
export function describeContractPeriod(terms, now = new Date()) {
  const start = parseContractDate(terms?.contractStartDate)
  const end = parseContractDate(terms?.contractEndDate)
  // 날짜만 비교하므로 한국 달력 기준이어야 한다. UTC로 재면 한국시간 0~9시에
  // 하루가 밀려, 만료일 당일에도 '만료 1일 전'으로 표시된다.
  const today = koreanToday(now)

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
  const exceedsFixedTermLimit = exceedsFixedTerm(start, end)

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

// 계약서 보존 의무 기간.
//
// 근로기준법 제42조는 근로계약서 등 근로관계 서류를 3년간 보존하게 하고,
// 시행령 제22조 제2항은 그 3년의 기산일을 "근로관계가 끝난 날"로 정한다.
// 서명일이 아니다. 이 둘을 섞으면 판정이 정확히 반대로 뒤집힌다 — 종료일이 없는
// 무기계약은 근로관계가 아직 끝나지 않아 보존 의무가 계속되는데, 서명일을
// 기산일로 쓰면 재직 중인 근로자의 계약서가 서명 3년 뒤 "보존 종료"로 표시된다.
// 지워도 되는 것처럼 보이는 서류를 지우게 만드는 것이 이 계산의 가장 큰 위험이다.
//
// 기산일 우선순위:
//   1) 기록된 실제 근로관계 종료일 — 사실
//   2) 계약 종료일 — 예정. 그 날이 아직 오지 않았으면 보존 기간은 시작 전이다.
//   3) 둘 다 없으면 근로관계가 끝나지 않은 것으로 본다 (보존 의무 계속).
export function describeRetention(terms, signedAt, now = new Date(), employmentEndedAt = null) {
  const today = koreanToday(now)
  const ended = parseContractDate(employmentEndedAt)
  const contractEnd = parseContractDate(terms?.contractEndDate)
  const signed = parseContractDate(signedAt)

  const base = ended || contractEnd
  const basisType = ended ? 'employment_ended' : contractEnd ? 'contract_end' : 'ongoing'

  // 근로관계가 끝난 날을 알 수 없다 = 아직 끝나지 않았다.
  if (!base) {
    if (!signed) return { known: false }
    return {
      known: true,
      started: false,
      ongoing: true,
      expired: false,
      basisType: 'ongoing',
      basis: null,
      until: null,
      remainingDays: null,
      signedAt: signed.toISOString().slice(0, 10),
      label: '재직 중 · 보존 의무 계속',
      detail:
        '종료일이 없는 근로계약이라 근로관계가 아직 끝나지 않았습니다. 근로기준법 제42조·시행령 제22조 제2항에 따라 보존 기간 3년은 근로관계가 끝난 날부터 세므로, 지금은 보존 의무가 계속됩니다.',
    }
  }

  const until = new Date(
    Date.UTC(base.getUTCFullYear() + RETENTION_YEARS, base.getUTCMonth(), base.getUTCDate())
  )
  const basisDate = base.toISOString().slice(0, 10)
  const untilDate = until.toISOString().slice(0, 10)
  const remainingDays = daysBetween(today, until)
  // 종료 예정일이 아직 오지 않았으면 보존 기간은 시작되지도 않았다.
  const started = base.getTime() <= today.getTime()
  const expired = started && remainingDays < 0

  let label
  let detail
  if (!started) {
    label = '재직 중 · 보존 의무 계속'
    detail = `근로관계 종료 예정일은 ${basisDate}입니다. 근로기준법 제42조의 3년 보존 기간은 근로관계가 끝난 날부터 세므로 ${untilDate}까지 보존해야 하며, 지금은 보존 기간이 시작되지도 않았습니다.`
  } else if (expired) {
    label = '보존 의무 기간 종료'
    detail = `근로관계가 끝난 날(${basisDate})부터 근로기준법 제42조의 3년 보존 기간(${untilDate})이 지났습니다.`
  } else {
    label = `보존 만료 ${remainingDays}일 전`
    detail = `근로관계가 끝난 날(${basisDate})을 기산일로, 근로기준법 제42조에 따라 ${untilDate}까지 보존해야 합니다.`
  }

  // 계약 종료일은 지났는데 실제 종료일이 기록되지 않은 경우, 계속 근무 중일 수
  // 있다. 기산일이 사실이 아니라 예정임을 밝혀야 잘못 지우지 않는다.
  if (basisType === 'contract_end' && started) {
    detail += ' 실제 근로관계 종료일이 기록되지 않아 계약 종료일을 기준으로 계산했습니다. 계속 근무 중이라면 보존 기간은 실제로 끝난 날부터 다시 셉니다.'
  }

  return {
    known: true,
    started,
    ongoing: !started,
    basisType,
    basis: basisDate,
    until: untilDate,
    remainingDays,
    expired,
    label,
    detail,
  }
}

// 보존 의무가 남은 계약서는 지울 수 없다.
//
// 지금까지 관리자 면접방 삭제에는 보존기간 검사가 없었다. 체결된 계약서를
// 언제든 지울 수 있으면 제42조의 보존 의무는 화면 문구일 뿐이다. 판단이
// 애매한 쪽(기산일을 알 수 없는 경우)은 보존하는 쪽으로 기운다 — 잘못
// 남기는 것보다 잘못 지우는 것이 되돌릴 수 없다.
export function describeRetentionHold(retention, isSigned) {
  if (!isSigned) return { held: false, reason: null }
  if (!retention?.known) {
    return {
      held: true,
      reason:
        '체결된 근로계약서인데 보존 기산일을 알 수 없어, 근로기준법 제42조의 3년 보존 의무가 남아 있는 것으로 봅니다.',
    }
  }
  if (retention.expired) return { held: false, reason: null }
  return { held: true, reason: retention.detail }
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

  const today = koreanToday(now)
  let totalMonths = 0
  let totalDays = 0
  const gaps = []

  parsed.forEach((s, i) => {
    // 진행 중인 마지막 계약은 종료일이 없으면 오늘까지로 센다.
    const end = s.end || (i === parsed.length - 1 ? today : null)
    // 종료일도 일한 날이다. "3월 1일 ~ 이듬해 2월 28일"은 11개월이 아니라 1년이므로
    // 하루를 더해 센다. 계속근로기간은 실제로 일한 기간이어야 한다.
    if (end) {
      totalMonths += Math.max(0, monthsBetween(s.start, new Date(end.getTime() + DAY_MS)) ?? 0)
      // 2년 초과 판정은 개월 내림이 아니라 일수로 한다 (단일 계약과 같은 기준).
      totalDays += Math.max(0, daysBetween(s.start, end) + 1)
    }

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
    totalDays,
    startDate: first.start.toISOString().slice(0, 10),
    endDate: (last.end || null)?.toISOString().slice(0, 10) ?? null,
    exceedsFixedTermLimit: totalDays > FIXED_TERM_LIMIT_DAYS,
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
