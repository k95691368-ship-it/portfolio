// 서명 전 최종 안전 점검 (순수 함수 — 단위 테스트 대상).
//
// 1) 합의 불일치: 채팅에서 AI가 추출한 조건 vs 현재 계약서 값
// 2) 법적 재검토: 최종 계약서 값 기준으로 최저임금·주52시간 재계산
// 3) 필수 누락: 계약서에 반드시 있어야 할 항목
//
// 법 계산은 AI가 아니라 결정론적 코드로 수행한다. 금액·시간은 매번 같은
// 결과가 나와야 하고, 지원자에게 보여주는 경고는 재현 가능해야 하기 때문.

import { effectiveWageItems, minimumWageBase, totalWage } from './wageItems.js'
import { workplaceScope, UNKNOWN_SIZE_CAVEAT } from './workplaceScope.js'

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
  breakTime: '휴게시간',
  wageBaseAmount: '기본급',
  wagePayMethod: '임금 지급방법',
  wagePayDate: '임금 지급일',
  annualLeave: '연차유급휴가',
  uniformSize: '유니폼 사이즈',
  employeeCount: '상시 근로자 수',
  socialInsurance: '사회보험',
  customTerms: '그 밖의 사항',
}

// 계약서에 반드시 있어야 하는 항목 (근로기준법 제17조 제1항 명시사항).
//
// 제17조 제1항이 직접 열거하는 것은 임금(구성항목·계산방법·지급방법),
// 소정근로시간, 제55조에 따른 휴일, 제60조에 따른 연차 유급휴가다. 그런데
// 휴일·연차·임금 지급방법이 목록에서 빠져 있어, 이 셋이 비어 있어도 "필수 항목
// 누락"으로 잡히지 않았다. 서면 명시 위반은 제114조 벌금 대상이다.
const REQUIRED_FIELDS = [
  'employerName',
  'employeeName',
  'contractStartDate',
  'workLocation',
  'jobDescription',
  'workHoursStart',
  'workHoursEnd',
  // 근무일이 빠져 있었다. 제17조 제1항 제2호가 명시하라는 것은 '소정근로시간'
  // 인데, 시작·종료 시각만으로는 주 몇 시간인지 정해지지 않는다. 게다가 근무일이
  // 비면 computeWeeklyHours 가 null 이 되어 최저임금·주52시간·연차·퇴직금·수습
  // 판정이 전부 조용히 생략된다. 필수 항목 검사가 통과시키므로 서명도 열린다 —
  // 경고 0건으로 최저임금 미달 계약이 체결될 수 있었다.
  'workDays',
  'restDays',
  'wageBaseAmount',
  'wagePayMethod',
  'wagePayDate',
  'annualLeave',
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

// 근로기준법 제54조 제1항 — "근로시간이 4시간인 경우에는 30분 이상, 8시간인
// 경우에는 1시간 이상의 휴게시간을 근로시간 도중에 주어야 한다."
//
// 조문의 기준은 '근로시간'이지 근무 구간이 아니고, 4시간·8시간 '인 경우'를
// 포함한다. 초과일 때만 요구하도록 되어 있어서, 09:00~13:00 정각 4시간
// 무휴게 계약이 경고 한 건 없이 통과했다.
export function breakMinutesFor(workMinutes) {
  if (workMinutes >= 8 * 60) return 60
  if (workMinutes >= 4 * 60) return 30
  return 0
}

// 계약서에 적힌 휴게시간이 실제로 몇 분인가. 읽을 수 없으면 null.
//
// "12:00~13:00" 같은 구간과 "1시간", "60분" 같은 길이를 모두 받는다. 사람이
// 실제로 적는 방식이 둘 다이고, 한쪽만 읽으면 적어 넣은 값이 없는 것으로
// 취급되어 있지도 않은 위반이 뜬다.
export function parseBreakMinutes(value) {
  const text = String(value ?? '').trim()
  if (!text) return null

  // 구간을 모두 더한다.
  //
  // 처음에는 첫 구간 하나만 읽었다. 그래서 "12:00~12:30, 18:00~18:30"(합계
  // 60분)이 30분으로 읽혀, 법을 지킨 계약에 형사처벌 문구가 붙은 경고가 떴다.
  // 휴게를 나눠 주는 것은 제54조가 막지 않는다 — 흔한 근무 형태다.
  //
  // "12시 30분 ~ 13시 30분"처럼 분까지 적는 표기도 받아야 한다. 이것을 놓치면
  // 아래 길이 폴백으로 떨어져 '30분'만 잡히고 역시 절반으로 읽힌다.
  const TIME = String.raw`(?:오전|오후|아침|점심|저녁|밤|새벽)?\s*\d{1,2}\s*(?::|시)\s*(?:\d{1,2}\s*분?)?`
  const SEP = String.raw`\s*(?:~|-|–|—|부터|to)\s*`
  const RANGE = new RegExp(`(${TIME})${SEP}(${TIME})`, 'g')

  let total = 0
  let found = 0
  for (const m of text.matchAll(RANGE)) {
    // 오전·오후는 캡처 안에 들어 있어야 한다. 밖으로 잘리면 parseTimeToMinutes
    // 가 그것을 못 보고 "오후 12시~오후 1시"가 거꾸로 읽힌다.
    const from = parseTimeToMinutes(m[1])
    const to = parseTimeToMinutes(m[2])
    if (from === null || to === null) continue
    let span = to - from
    // 12시→1시처럼 오후 표기가 없는 짧은 구간은 자정을 넘긴 것이 아니다.
    if (span < 0) span += 12 * 60
    if (span <= 0 || span > 8 * 60) continue
    total += span
    found += 1
  }
  if (found > 0) return total

  // 구간이 하나도 없을 때만 길이 표기를 본다.
  //
  // 그런데 "8시간 근무 시 1시간"처럼 법 문구를 그대로 옮겨 적는 것이 가장
  // 흔한 입력이다. 아무 숫자나 잡으면 그것이 '휴게 480분'이 되어 제54조 검사가
  // 통째로 꺼진다. 그래서 근무를 가리키는 말이 섞여 있으면 읽지 않는다 —
  // 모르는 것으로 두는 편이 480분이라고 잘못 아는 것보다 낫다.
  if (/근무|근로|소정|기준|이상|초과|마다|당|경우/.test(text)) return null

  const hours = text.match(/(\d+(?:\.\d+)?)\s*시간/)
  const minutes = text.match(/(\d+)\s*분/)
  if (hours || minutes) {
    const length = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0)
    // 휴게가 4시간을 넘는다고 적었다면 그건 휴게 길이가 아니다.
    return length > 0 && length <= 4 * 60 ? Math.round(length) : null
  }
  return null
}

// 근무 시각·근무일에서 주간 실근로시간을 계산. 정보 부족 시 null.
// 계약 조건이 아직 없는 방에서도 호출되므로 빈 값을 받아도 깨지지 않게 한다.
export function computeWeeklyHours(terms) {
  const { workHoursStart, workHoursEnd, workDays } = terms || {}
  const start = parseTimeToMinutes(workHoursStart)
  const end = parseTimeToMinutes(workHoursEnd)
  const days = parseDaysPerWeek(workDays)
  if (start === null || end === null || days === null) return null

  // 시작과 종료가 같으면 근무시간을 알 수 없는 것이지, 24시간 근무가 아니다.
  // 그런데 span 0 이 자정 보정을 타고 1440분이 되어, 09:00~09:00 이 하루 23시간
  // (휴게 제외) 주 115시간으로 읽혔다. 없는 위반 두 건이 서명을 막고, 그
  // 시간으로 계산한 터무니없는 금액이 '최소 적법 임금'으로 제안된다.
  if (end === start) return null

  let span = end - start
  if (span < 0) span += 24 * 60 // 야간 교대 등 자정을 넘기는 경우
  if (span <= 0 || span > 24 * 60) return null

  // 계약서에 적힌 휴게시간을 뺀다.
  //
  // 지금까지는 언제나 '법정 최소'만 뺐다. 그래서 휴게를 법보다 길게 주기로 한
  // 계약이 실제보다 오래 일하는 것으로 계산됐다. 09:00~21:00 주 5일에 휴게
  // 2시간이면 실제 주 50시간인데 55시간으로 읽혀, 적법한 계약에 '주 52시간
  // 초과'가 high 로 뜨고 서명이 막혔다. 최저임금 계산도 같은 값을 나눗수로
  // 쓰므로 필요 없는 인상액이 '최소 적법 금액'으로 제시됐다.
  //
  // 적히지 않았으면 예전처럼 법정 최소를 뺀다 — 법정 휴게는 주게 되어 있으므로
  // 모른다고 0으로 두면 근로시간이 과대 계산된다. 그 경우 제54조 검사가 따로
  // '휴게시간 미기재'로 알린다.
  const stated = parseBreakMinutes(terms?.breakTime)
  const rest = stated ?? breakMinutesFor(span)
  const daily = (span - rest) / 60
  if (daily <= 0) return null
  return Math.round(daily * days * 100) / 100
}

// 월 소정근로시간 = (주 소정근로 + 주휴시간) × 4.345
//
// 주휴시간은 주 15시간 이상 근무 시 주 소정근로에 비례해 발생한다.
//
// 여기서 '소정근로'는 법정 기준(주 40시간) 안에서 정한 시간이다. 그 위로 더
// 일하기로 한 시간은 연장근로이고, 최저임금법 시행령 제5조가 나누라고 하는
// 것은 소정근로시간이지 실근로시간이 아니다.
//
// 그런데 이 함수는 주 60시간 계약에 60시간을 그대로 넣어 나눗수를 295시간까지
// 키웠다. 분자에서는 고정연장수당을 빼면서 분모에는 연장근로시간을 넣은 셈이라,
// 같은 오류가 양쪽에서 겹쳐 적법한 계약이 최저임금 미달로 잡혔다. 통상시급도
// 같은 함수를 쓰므로 가산수당 단가까지 함께 낮아졌다.
//
// 실제 시간은 209시간처럼 정수로 이야기되므로 반올림해서 돌려준다. 208.57 을
// 그대로 쓰면 경계에 걸친 계약이 나눗수가 작다는 이유만으로 통과한다.
export function monthlyPaidHours(weeklyHours) {
  const contracted = Math.min(weeklyHours, STANDARD_WEEKLY_HOURS)
  const weeklyHoliday = weeklyHours >= 15 ? (contracted / STANDARD_WEEKLY_HOURS) * 8 : 0
  return Math.round((contracted + weeklyHoliday) * WEEKS_PER_MONTH)
}

// 최종 계약서 값 기준 법적 검토. [{severity, title, detail}]
export function checkLegalCompliance(terms) {
  const issues = []
  const weeklyHours = computeWeeklyHours(terms)

  // 제53조(연장근로 제한)와 제56조(가산수당)는 상시 5명 이상 사업장에만
  // 적용된다(제11조·시행령 제7조 별표1). 4명 이하인데도 '주 52시간 초과'를
  // high 로 띄우면, 위반이 아닌 계약의 서명을 서버가 거부한다.
  const scope = workplaceScope(terms)
  const sizeNote = scope.known ? '' : ` ${UNKNOWN_SIZE_CAVEAT}`

  // 근로기준법 제54조 — 4시간 근로에 30분 이상, 8시간 근로에 1시간 이상의
  // 휴게를 근로시간 도중에 주어야 한다. 상시 근로자 수와 무관하게 적용된다.
  //
  // 주 근로시간 계산은 이 최소 휴게를 이미 뺀 값으로 돌고 있었다. 즉 "법정
  // 휴게를 준다"고 전제하면서, 정작 계약서에 적힌 휴게시간이 그만큼인지는
  // 아무도 보지 않았다. 전제와 문서가 어긋나 있어도 통과한다.
  const startMin = parseTimeToMinutes(terms?.workHoursStart)
  const endMin = parseTimeToMinutes(terms?.workHoursEnd)
  if (startMin !== null && endMin !== null && endMin !== startMin) {
    let span = endMin - startMin
    if (span < 0) span += 24 * 60
    const given = parseBreakMinutes(terms?.breakTime)
    // 제54조의 기준은 근로시간이다. 근무 구간에서 실제 휴게를 뺀 값이 곧
    // 근로시간이다.
    //
    // 적힌 것이 없을 때 '법정 최소를 준 것'으로 빼면 안 된다. 그러면 09:00~13:00
    // 정각 4시간 계약에서 근로시간이 3.5시간이 되어 요구 자체가 사라지고,
    // 휴게를 한 번도 적지 않은 계약이 경고 없이 통과한다. 요구량을 정할 때는
    // 휴게가 없는 것으로 본다 — 그것이 그 문서가 말하고 있는 내용이다.
    const workMinutes = span - (given ?? 0)
    const required = breakMinutesFor(workMinutes)
    if (required > 0) {
      if (given === null) {
        issues.push({
          severity: 'medium',
          title: '휴게시간 미기재',
          detail: `1일 근로시간이 ${Math.round((workMinutes / 60) * 10) / 10}시간이면 근로기준법 제54조에 따라 최소 ${required}분의 휴게를 근로시간 도중에 주어야 합니다. 계약서에 휴게시간이 적혀 있지 않으면 그 사실을 확인할 수 없고, 휴게시간은 제17조 제1항 제5호·시행령 제8조 제2호(제93조 제1호)의 명시사항입니다.`,
          field: 'breakTime',
        })
      } else if (given < required) {
        issues.push({
          severity: 'high',
          title: '휴게시간 부족',
          detail: `1일 근로시간 ${Math.round((workMinutes / 60) * 10) / 10}시간에는 최소 ${required}분의 휴게가 필요한데(근로기준법 제54조), 계약서에는 ${given}분으로 적혀 있습니다. 위반 시 2년 이하 징역 또는 2천만원 이하 벌금(제110조)입니다.`,
          field: 'breakTime',
          suggestedValue: null,
        })
      }
    }
  }

  if (!scope.small && weeklyHours !== null && weeklyHours > MAX_WEEKLY_HOURS) {
    issues.push({
      severity: 'high',
      title: '주 52시간 초과',
      detail: `계약서상 주 근로시간이 약 ${weeklyHours}시간으로, 연장근로를 포함한 법정 상한(주 52시간)을 초과합니다.${sizeNote}`,
    })
  } else if (!scope.small && weeklyHours !== null && weeklyHours > STANDARD_WEEKLY_HOURS) {
    issues.push({
      severity: 'info',
      title: '연장근로 포함',
      detail: `주 근로시간이 약 ${weeklyHours}시간으로 법정 소정근로(주 40시간)를 초과합니다. 초과분에는 가산수당(1.5배)이 지급되어야 합니다.${sizeNote}`,
    })
  } else if (scope.small && weeklyHours !== null && weeklyHours > STANDARD_WEEKLY_HOURS) {
    // 적용되지 않는다는 사실 자체는 알려야 한다. 조용히 넘어가면 근로자는
    // 가산수당을 받을 수 있다고 오해한 채 서명한다.
    issues.push({
      severity: 'info',
      title: '연장근로 제한·가산수당 미적용 사업장',
      detail: `주 근로시간이 약 ${weeklyHours}시간이지만, 상시 근로자 ${scope.count}명(4명 이하) 사업장이라 주 52시간 상한(제53조)과 연장·야간·휴일 가산수당(제56조)이 적용되지 않습니다(제11조 제1항·시행령 제7조 별표1). 최저임금·휴게·주휴일·퇴직급여는 그대로 적용됩니다.`,
    })
  }

  // 최저임금은 기본급이 아니라 '산입 대상 임금'과 비교한다.
  //
  // 기본급만 보면 식대·고정수당이 붙은 계약을 실제보다 낮게 읽어 없는 위반을
  // 만들고, 반대로 합계만 보면 고정연장수당이 낀 계약의 진짜 위반을 놓친다.
  // 항목을 입력하지 않은 계약은 기본급 하나로 취급되어 예전과 같이 계산된다.
  const items = effectiveWageItems(terms)
  const wage = minimumWageBase(items)
  const paidTotal = totalWage(items)
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
          detail:
            (paidTotal > wage
              ? `월 지급액 합계는 ${paidTotal.toLocaleString('ko-KR')}원이지만, 최저임금에 산입되는 금액은 ${wage.toLocaleString('ko-KR')}원입니다(소정근로 외의 대가는 제외 — 최저임금법 제6조 제4항). 이를 `
              : `기본급 ${wage.toLocaleString('ko-KR')}원을 `) +
            `월 소정근로시간(약 ${Math.round(hours)}시간)으로 나누면 시급 약 ${hourly.toLocaleString('ko-KR')}원으로, 2026년 최저시급(${MINIMUM_HOURLY_WAGE_2026.toLocaleString('ko-KR')}원)에 미달합니다. 이 근로시간에서 최저임금을 지키려면 산입 대상 임금이 최소 ${lawfulMinimum.toLocaleString('ko-KR')}원이어야 합니다.`,
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
// 값이 채워져 있는지가 아니라, 그 값으로 법정 계산이 되는지까지 본다.
//
// 근무 시각에 "아홉시"라고 적으면 필수 항목 검사는 값이 있으니 통과시킨다.
// 그런데 시각을 읽지 못하면 주 근로시간이 null 이 되고, 최저임금·주52시간·
// 연차·퇴직금·수습 판정이 전부 조용히 생략된다. 화면에는 경고가 하나도 뜨지
// 않으므로 "점검을 통과했다"로 보이고, 그대로 서명된다. 검사가 없는 것보다
// 나쁘다 — 없으면 사람이 확인하지만, 통과했다고 하면 아무도 보지 않는다.
const UNREADABLE_CHECKS = [
  { field: 'workHoursStart', read: (t) => parseTimeToMinutes(t.workHoursStart) },
  { field: 'workHoursEnd', read: (t) => parseTimeToMinutes(t.workHoursEnd) },
  { field: 'workDays', read: (t) => parseDaysPerWeek(t.workDays) },
]

function findUnreadableFields(terms) {
  const t = terms || {}
  const filled = (v) => v !== null && v !== undefined && String(v).trim() !== ''
  const bad = UNREADABLE_CHECKS.filter((c) => filled(t[c.field]) && c.read(t) === null).map((c) => ({
    field: c.field,
    label: FIELD_LABELS[c.field] || c.field,
    value: String(t[c.field]),
  }))

  // 시작과 종료를 각각은 읽었는데 같은 값이면 근무시간이 0이다. 항목별로는
  // 문제가 없어 보이므로 따로 잡는다.
  const start = parseTimeToMinutes(t.workHoursStart)
  const end = parseTimeToMinutes(t.workHoursEnd)
  if (start !== null && end !== null && start === end && bad.length === 0) {
    bad.push({
      field: 'workHoursEnd',
      label: FIELD_LABELS.workHoursEnd,
      value: String(t.workHoursEnd),
      sameAsStart: true,
    })
  }
  return bad
}

export function findMissingFields(terms) {
  const t = terms || {}
  const missing = REQUIRED_FIELDS.filter((f) => {
    const v = t[f]
    if (v === null || v === undefined || String(v).trim() === '') return true
    // 0원·음수는 "적혀 있다"로 통과하는데 최저임금 계산은 wage > 0 에서
    // 멈춘다. 채워졌으니 서명은 열리고 검사는 꺼지는 자리다.
    if (f === 'wageBaseAmount') {
      const amount = Number(v)
      return !Number.isFinite(amount) || amount <= 0
    }
    return false
  }).map((f) => ({ field: f, label: FIELD_LABELS[f] || f }))

  // 읽을 수 없는 값은 채워지지 않은 것과 같이 다룬다. 서명을 막는 목록이
  // 이것 하나이므로, 여기에 넣지 않으면 막히지 않는다.
  for (const bad of findUnreadableFields(t)) {
    if (missing.some((m) => m.field === bad.field)) continue
    missing.push({
      field: bad.field,
      label: bad.label,
      unreadable: true,
      note: bad.sameAsStart
        ? `시작 시각과 같아 근무시간이 0이 됩니다. 실제 종료 시각을 적어주세요.`
        : `"${bad.value}"은(는) 근로시간 계산에 쓸 수 없는 표기입니다. 09:00 처럼 적어주세요.`,
    })
  }
  return missing
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
