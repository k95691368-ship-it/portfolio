// 서명 전 최종 안전 점검 (순수 함수 — 단위 테스트 대상).
//
// 1) 합의 불일치: 채팅에서 AI가 추출한 조건 vs 현재 계약서 값
// 2) 법적 재검토: 최종 계약서 값 기준으로 최저임금·주52시간 재계산
// 3) 필수 누락: 계약서에 반드시 있어야 할 항목
//
// 법 계산은 AI가 아니라 결정론적 코드로 수행한다. 금액·시간은 매번 같은
// 결과가 나와야 하고, 지원자에게 보여주는 경고는 재현 가능해야 하기 때문.

export const MINIMUM_HOURLY_WAGE_2026 = 10320 // 2026년 최저시급
const WEEKS_PER_MONTH = 365 / 7 / 12 // ≈ 4.345
const MAX_WEEKLY_HOURS = 52 // 연장 포함 법정 상한
const STANDARD_WEEKLY_HOURS = 40 // 법정 소정근로

export const FIELD_LABELS = {
  employerName: '사업체명',
  employerAddress: '사업장 주소',
  employeeName: '근로자명',
  employeeAddress: '근로자 주소',
  contractStartDate: '근로개시일',
  contractEndDate: '근로계약 종료일',
  workLocation: '근무장소',
  jobDescription: '업무의 내용',
  workHoursStart: '근무 시작 시각',
  workHoursEnd: '근무 종료 시각',
  workDays: '근무일',
  restDays: '휴일',
  wageBaseAmount: '기본급',
  wagePayMethod: '임금 지급방법',
  wagePayDate: '임금 지급일',
  annualLeave: '연차유급휴가',
  uniformSize: '유니폼 사이즈',
  socialInsurance: '사회보험',
  customTerms: '그 밖의 사항',
}

// 계약서에 반드시 있어야 하는 항목 (근로기준법 제17조 명시사항 기준)
const REQUIRED_FIELDS = [
  'employerName',
  'employeeName',
  'contractStartDate',
  'workLocation',
  'jobDescription',
  'workHoursStart',
  'workHoursEnd',
  'wageBaseAmount',
  'wagePayDate',
]

// "09:00", "9:00", "9시", "오후 6시" 형태를 분 단위로. 실패 시 null.
//
// 오전/오후를 무시하면 "오후 6시"가 06:00이 되어, 09:00~오후 6시(=9시간) 계약이
// 자정을 넘긴 것으로 처리돼 하루 21시간·주 100시간으로 계산된다. 그 결과 적법한
// 계약에 "주 52시간 초과"와 "최저임금 미달"이 동시에 뜨고, 근로자에게 잘못된
// 인상 금액이 제안된다. 이 값은 AI가 대화체로 뽑아 오기도 하고 회사가 직접
// 자유 입력하기도 하므로 반드시 12시간제 표기를 읽어야 한다.
export function parseTimeToMinutes(value) {
  if (typeof value !== 'string') return null
  const colon = value.match(/(\d{1,2})\s*[:시]\s*(\d{1,2})?/)
  if (!colon) return null
  let h = Number(colon[1])
  const m = Number(colon[2] || 0)
  if (!Number.isFinite(h) || h < 0 || h > 24 || m < 0 || m > 59) return null

  // 오전 12시는 자정(0시), 오후 12시는 정오(12시)다.
  const pm = /오후|PM|pm/.test(value)
  const am = /오전|AM|am/.test(value)
  if (pm && h < 12) h += 12
  else if (am && h === 12) h = 0

  return h * 60 + m
}

// "주 5일 (월~금)", "월~금", "월요일~금요일", "주5일" → 5. 실패 시 null.
export function parseDaysPerWeek(value) {
  if (typeof value !== 'string') return null

  // "요일"의 '일'이 요일 글자로 잡히면 범위가 어긋난다.
  // "월요일~금요일"은 '월'~'일'로 읽혀 6일이 되고, "토요일~일요일"은 '요'가
  // 아닌 '토'~'일'... 이 아니라 '일'~'일'로 읽혀 1일이 된다. 전자는 적법한
  // 계약에 최저임금 미달 경고를 띄우고, 후자는 진짜 미달 계약을 통과시킨다.
  const text = value.replace(/요일/g, '')

  const explicit = text.match(/주\s*(\d)\s*일/)
  if (explicit) {
    const n = Number(explicit[1])
    if (n >= 1 && n <= 7) return n
  }
  // "월~금" 같은 요일 범위
  const order = ['월', '화', '수', '목', '금', '토', '일']
  const range = text.match(/([월화수목금토일])\s*[~-]\s*([월화수목금토일])/)
  if (range) {
    const from = order.indexOf(range[1])
    const to = order.indexOf(range[2])
    if (from >= 0 && to >= 0) return to >= from ? to - from + 1 : 7 - from + to + 1
  }
  // "월, 화, 수" 나열
  const listed = text.match(/[월화수목금토일]/g)
  if (listed) {
    const unique = new Set(listed)
    if (unique.size >= 1 && unique.size <= 7) return unique.size
  }
  return null
}

// 근로기준법 제54조 휴게: 4시간 초과 30분, 8시간 초과 1시간.
export function breakMinutesFor(spanMinutes) {
  if (spanMinutes > 8 * 60) return 60
  if (spanMinutes > 4 * 60) return 30
  return 0
}

// 근무 시각·근무일에서 주간 실근로시간을 계산. 정보 부족 시 null.
export function computeWeeklyHours({ workHoursStart, workHoursEnd, workDays }) {
  const start = parseTimeToMinutes(workHoursStart)
  const end = parseTimeToMinutes(workHoursEnd)
  const days = parseDaysPerWeek(workDays)
  if (start === null || end === null || days === null) return null

  let span = end - start
  if (span <= 0) span += 24 * 60 // 야간 교대 등 자정을 넘기는 경우
  if (span <= 0 || span > 24 * 60) return null

  const daily = (span - breakMinutesFor(span)) / 60
  if (daily <= 0) return null
  return Math.round(daily * days * 100) / 100
}

// 월 소정근로시간 = (주 소정근로 + 주휴시간) × 4.345
// 주휴시간은 주 15시간 이상 근무 시 주 소정근로에 비례해 발생.
export function monthlyPaidHours(weeklyHours) {
  const weeklyHoliday = weeklyHours >= 15 ? (Math.min(weeklyHours, STANDARD_WEEKLY_HOURS) / STANDARD_WEEKLY_HOURS) * 8 : 0
  return (weeklyHours + weeklyHoliday) * WEEKS_PER_MONTH
}

// 최종 계약서 값 기준 법적 검토. [{severity, title, detail}]
export function checkLegalCompliance(terms) {
  const issues = []
  const weeklyHours = computeWeeklyHours(terms)

  if (weeklyHours !== null && weeklyHours > MAX_WEEKLY_HOURS) {
    issues.push({
      severity: 'high',
      title: '주 52시간 초과',
      detail: `계약서상 주 근로시간이 약 ${weeklyHours}시간으로, 연장근로를 포함한 법정 상한(주 52시간)을 초과합니다.`,
    })
  } else if (weeklyHours !== null && weeklyHours > STANDARD_WEEKLY_HOURS) {
    issues.push({
      severity: 'info',
      title: '연장근로 포함',
      detail: `주 근로시간이 약 ${weeklyHours}시간으로 법정 소정근로(주 40시간)를 초과합니다. 초과분에는 가산수당(1.5배)이 지급되어야 합니다.`,
    })
  }

  const wage = Number(terms.wageBaseAmount)
  if (Number.isFinite(wage) && wage > 0 && weeklyHours !== null) {
    const hours = monthlyPaidHours(weeklyHours)
    if (hours > 0) {
      const hourly = Math.round(wage / hours)
      if (hourly < MINIMUM_HOURLY_WAGE_2026) {
        // 적법한 최소 월급을 함께 계산해, 지원자가 바로 이 값으로 수정을 요청할 수 있게 한다.
        const lawfulMinimum = Math.ceil((MINIMUM_HOURLY_WAGE_2026 * hours) / 10) * 10
        issues.push({
          severity: 'high',
          title: '최저임금 미달 소지',
          detail: `기본급 ${wage.toLocaleString('ko-KR')}원을 월 소정근로시간(약 ${Math.round(hours)}시간)으로 나누면 시급 약 ${hourly.toLocaleString('ko-KR')}원으로, 2026년 최저시급(${MINIMUM_HOURLY_WAGE_2026.toLocaleString('ko-KR')}원)에 미달합니다. 이 근로시간에서 최저임금을 지키려면 기본급이 최소 ${lawfulMinimum.toLocaleString('ko-KR')}원이어야 합니다.`,
          field: 'wageBaseAmount',
          suggestedValue: String(lawfulMinimum),
        })
      }
    }
  }

  const si = terms.socialInsurance
  if (si && typeof si === 'object') {
    const off = Object.entries(si)
      .filter(([, v]) => v === false)
      .map(([k]) => k)
    if (off.length > 0) {
      issues.push({
        severity: 'medium',
        title: '사회보험 미적용 항목',
        detail: `4대보험 중 적용하지 않기로 표기된 항목이 있습니다(${off.length}건). 가입 요건에 해당하면 사업주는 가입 의무가 있습니다.`,
      })
    }
  }

  return issues
}

// 계약서에서 빠진 필수 항목
export function findMissingFields(terms) {
  return REQUIRED_FIELDS.filter((f) => {
    const v = terms[f]
    return v === null || v === undefined || String(v).trim() === ''
  }).map((f) => ({ field: f, label: FIELD_LABELS[f] || f }))
}

// 값 표시용 문자열 정규화 (숫자/JSON 대비)
function displayValue(v) {
  if (v === null || v === undefined || v === '') return '(비어 있음)'
  if (typeof v === 'number') return `${v.toLocaleString('ko-KR')}`
  return String(v)
}

// 같은 뜻인데 표기만 다른 값을 비교 가능한 형태로 통일한다.
// AI는 대화체("2026년 9월 1일", "9시")로 추출하고, 계약서 폼은 입력 위젯
// 형식("2026-09-01", "09:00")으로 저장하기 때문에, 그대로 비교하면 실제로는
// 같은 값이 "변경됨"으로 잡힌다. 허위 경고는 진짜 경고의 신뢰를 떨어뜨리므로
// 비교 전에 반드시 정규화한다.
export function normalizeForCompare(value) {
  if (value === null || value === undefined) return ''
  const raw = String(value).trim()
  if (raw === '') return ''

  // 날짜: 2026년 9월 1일 / 2026.09.01 / 2026/9/1 / 2026-09-01 → 2026-09-01
  const date = raw.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/)
  if (date) {
    const [, y, m, d] = date
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // 시각: 9시 / 9:00 / 09:00 → 09:00 (날짜가 아닌 순수 시각 표기일 때만)
  const time = raw.match(/^(\d{1,2})\s*[:시]\s*(\d{1,2})?\s*분?$/)
  if (time) {
    const h = time[1].padStart(2, '0')
    const min = (time[2] || '0').padStart(2, '0')
    return `${h}:${min}`
  }

  // 금액·수량: 3,200,000 / 3200000원 → 3200000
  const numeric = raw.replace(/[,\s]/g, '').replace(/원$/, '')
  if (/^\d+$/.test(numeric)) return String(Number(numeric))

  // 그 외에는 연속 공백만 정리해서 비교
  return raw.replace(/\s+/g, ' ')
}

// 채팅에서 합의된 값 vs 현재 계약서 값 비교.
// history는 오래된 것부터 정렬된 [{changes:[{field, from, to}], source}] 형태.
// 각 필드의 "최초 from"이 AI가 대화에서 추출한 합의 값이다.
//
// 단, 지원자가 요청하고 회사가 수락한 변경(source: 'change_request')은 양측이
// 합의한 것이므로 불일치가 아니다. 그 값이 새로운 합의 기준이 된다.
export function diffAgreedVsCurrent(history, currentTerms) {
  const agreed = new Map()
  for (const entry of history) {
    for (const change of entry.changes || []) {
      if (entry.source === 'change_request') {
        agreed.set(change.field, change.to)
        continue
      }
      if (!agreed.has(change.field)) agreed.set(change.field, change.from)
    }
  }

  const diffs = []
  for (const [field, agreedValue] of agreed) {
    // 비교 대상이 아닌 항목(사회보험/기타조건 등 구조체)은 문자열 비교가 무의미해 제외
    if (field === 'socialInsurance' || field === 'customTerms') continue

    const current = currentTerms[field]
    const before = normalizeForCompare(agreedValue)
    const after = normalizeForCompare(current)
    if (before === after) continue
    // 비어 있던 항목을 채운 것은 "변경"이 아니라 보완이므로 알리지 않는다.
    if (before === '') continue

    diffs.push({
      field,
      label: FIELD_LABELS[field] || field,
      agreed: displayValue(agreedValue),
      current: displayValue(current),
    })
  }
  return diffs
}
