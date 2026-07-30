// 근로자를 위한 계약 해설 (순수 함수 — 단위 테스트 대상).
//
// 이 앱의 계산과 AI는 지금까지 거의 전부 회사 쪽을 도왔다. 조건 추출, 계약서
// 작성, 서류 심사, 면접 요약이 모두 회사 기능이고, 근로자가 받는 것은 위반
// 경고와 수정 요청 버튼뿐이었다. 정작 "내가 지금 어떤 계약에 서명하려는가"는
// 표에 적힌 값을 스스로 해석해야 했다.
//
// 계약서에 적힌 값만으로는 알 수 없는 것들이 있다. 기본급 220만원이 적법한지는
// 근무시간을 알아야 하고, "주 5일 09:00~18:00"이 몇 시간인지는 휴게시간을
// 빼야 하고, 2년 계약이 무기계약 전환 대상인지는 날짜를 세어야 한다. 이미
// 그 계산을 하고 있으므로, 결과를 근로자가 읽을 수 있는 문장으로 돌려준다.
//
// AI를 쓰지 않는다. 사람의 임금과 근로시간에 관한 설명은 매번 같아야 하고,
// 왜 그런 숫자가 나왔는지 근거를 댈 수 있어야 한다.

import {
  MINIMUM_HOURLY_WAGE_2026,
  computeWeeklyHours,
  monthlyPaidHours,
  parseTimeToMinutes,
  parseDaysPerWeek,
  breakMinutesFor,
} from './contractCheck.js'
import { describeContractPeriod } from './contractPeriod.js'

const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`
const hours = (n) => `${Math.round(n * 10) / 10}시간`

function line(label, value, note, tone = 'info') {
  return { label, value, note: note ?? null, tone }
}

const UNKNOWN = '적혀 있지 않음'

// 임금이 최저임금을 지키는지, 시급으로 얼마인지.
function wageSection(terms) {
  const lines = []
  const wage = Number(terms?.wageBaseAmount)
  const hasWage = Number.isFinite(wage) && wage > 0

  lines.push(
    line('기본급', hasWage ? `월 ${won(wage)}` : UNKNOWN, hasWage ? null : '반드시 적혀 있어야 합니다.', hasWage ? 'info' : 'caution')
  )
  lines.push(line('지급일', terms?.wagePayDate || UNKNOWN, null, terms?.wagePayDate ? 'info' : 'caution'))
  lines.push(
    line('지급방법', terms?.wagePayMethod || UNKNOWN, null, terms?.wagePayMethod ? 'info' : 'caution')
  )

  const weekly = computeWeeklyHours(terms)
  if (!hasWage || weekly === null) {
    lines.push(
      line(
        '시급 환산',
        '계산할 수 없음',
        '기본급과 근무시간(시작·종료 시각, 근무일)이 모두 적혀 있어야 시급을 환산할 수 있습니다.',
        'caution'
      )
    )
    return { title: '임금', lines }
  }

  const monthly = monthlyPaidHours(weekly)
  const hourly = Math.round(wage / monthly)
  const diff = hourly - MINIMUM_HOURLY_WAGE_2026

  lines.push(
    line(
      '시급 환산',
      won(hourly),
      `월 기본급 ${won(wage)} ÷ 월 소정근로시간 약 ${hours(monthly)} (주휴시간 포함)`,
      'info'
    )
  )

  if (diff >= 0) {
    lines.push(
      line(
        '최저임금 비교',
        `${won(diff)} 높음`,
        `2026년 최저시급은 ${won(MINIMUM_HOURLY_WAGE_2026)}입니다. 이 계약은 최저임금을 지킵니다.`,
        'ok'
      )
    )
  } else {
    const lawful = Math.ceil((MINIMUM_HOURLY_WAGE_2026 * monthly) / 10) * 10
    lines.push(
      line(
        '최저임금 비교',
        `${won(-diff)} 미달`,
        `2026년 최저시급은 ${won(MINIMUM_HOURLY_WAGE_2026)}입니다. 이 근무시간에서 최저임금을 지키려면 기본급이 최소 ${won(lawful)}이어야 합니다. 회사에 수정을 요청할 수 있습니다.`,
        'caution'
      )
    )
  }

  return { title: '임금', lines }
}

// 하루 몇 시간 일하고, 주 몇 시간인지.
function hoursSection(terms) {
  const lines = []
  const start = parseTimeToMinutes(terms?.workHoursStart)
  const end = parseTimeToMinutes(terms?.workHoursEnd)
  const days = parseDaysPerWeek(terms?.workDays)

  lines.push(
    line(
      '근무 시각',
      terms?.workHoursStart && terms?.workHoursEnd
        ? `${terms.workHoursStart} ~ ${terms.workHoursEnd}`
        : UNKNOWN,
      null,
      start !== null && end !== null ? 'info' : 'caution'
    )
  )
  lines.push(line('근무일', terms?.workDays || UNKNOWN, null, days !== null ? 'info' : 'caution'))

  if (start !== null && end !== null) {
    let span = end - start
    if (span <= 0) span += 24 * 60
    const rest = breakMinutesFor(span)
    lines.push(
      line(
        '하루 근로시간',
        hours((span - rest) / 60),
        rest > 0
          ? `근무 구간 ${hours(span / 60)}에서 휴게 ${rest}분을 뺀 시간입니다. 근로기준법 제54조는 4시간 초과 30분, 8시간 초과 1시간의 휴게를 근로시간 도중에 주도록 합니다.`
          : '4시간을 넘지 않아 법정 휴게시간이 발생하지 않습니다.',
        'info'
      )
    )
  }

  const weekly = computeWeeklyHours(terms)
  if (weekly === null) {
    lines.push(line('주 근로시간', '계산할 수 없음', '근무 시각과 근무일이 모두 적혀 있어야 합니다.', 'caution'))
    return { title: '근로시간', lines }
  }

  lines.push(line('주 근로시간', hours(weekly), null, 'info'))

  if (weekly > 52) {
    lines.push(
      line(
        '법정 한도',
        '초과',
        `연장근로를 포함한 법정 상한은 주 52시간입니다. 이 계약은 주 ${hours(weekly)}로 상한을 넘습니다.`,
        'caution'
      )
    )
  } else if (weekly > 40) {
    lines.push(
      line(
        '법정 한도',
        '연장근로 포함',
        `법정 소정근로는 주 40시간입니다. 초과하는 ${hours(weekly - 40)}에는 통상임금의 1.5배 이상 가산수당이 지급되어야 합니다.`,
        'caution'
      )
    )
  } else {
    lines.push(line('법정 한도', '이내', '법정 소정근로(주 40시간) 이내입니다.', 'ok'))
  }

  if (weekly >= 15) {
    lines.push(
      line('주휴수당', '발생', '주 15시간 이상 근무하므로 유급 주휴일이 발생합니다.', 'ok')
    )
  } else {
    lines.push(
      line(
        '주휴수당',
        '발생하지 않음',
        '주 15시간 미만이면 주휴수당과 연차유급휴가가 발생하지 않습니다.',
        'caution'
      )
    )
  }

  return { title: '근로시간', lines }
}

// 얼마나 일하는 계약인지, 무기계약 전환 대상인지.
function periodSection(terms, now) {
  const lines = []
  const period = describeContractPeriod(terms, now)

  if (!period.known) {
    lines.push(line('계약 기간', UNKNOWN, '근로개시일은 반드시 적혀 있어야 합니다.', 'caution'))
    return { title: '계약 기간', lines }
  }

  if (period.openEnded) {
    lines.push(
      line(
        '계약 기간',
        '기간의 정함 없음',
        `${period.startDate}부터 시작하며 종료일이 없습니다. 정당한 이유 없이 해고할 수 없습니다.`,
        'ok'
      )
    )
    return { title: '계약 기간', lines }
  }

  lines.push(
    line(
      '계약 기간',
      `${period.startDate ?? UNKNOWN} ~ ${period.endDate}`,
      period.months !== null ? `약 ${period.months}개월` : null,
      'info'
    )
  )

  if (period.exceedsFixedTermLimit) {
    lines.push(
      line(
        '기간제 2년 상한',
        '초과',
        '기간제법 제4조는 2년을 초과해 기간제로 사용한 근로자를 기간의 정함이 없는 근로계약을 체결한 것으로 봅니다. 이 계약은 그 기준을 넘습니다.',
        'caution'
      )
    )
  } else {
    lines.push(line('기간제 2년 상한', '이내', '2년을 넘지 않는 기간제 계약입니다.', 'ok'))
  }

  return { title: '계약 기간', lines }
}

function restSection(terms) {
  return {
    title: '휴일과 휴가',
    lines: [
      line('휴일', terms?.restDays || UNKNOWN, null, terms?.restDays ? 'info' : 'caution'),
      line(
        '연차유급휴가',
        terms?.annualLeave || UNKNOWN,
        terms?.annualLeave
          ? null
          : '근로기준법 제60조에 따른 연차유급휴가는 계약서에 적혀 있어야 합니다.',
        terms?.annualLeave ? 'info' : 'caution'
      ),
    ],
  }
}

const INSURANCE_LABELS = {
  employment_insurance: '고용보험',
  health_insurance: '건강보험',
  national_pension: '국민연금',
  industrial_accident_insurance: '산재보험',
}

function insuranceSection(terms) {
  const si = terms?.socialInsurance
  if (!si || typeof si !== 'object') {
    return {
      title: '사회보험',
      lines: [line('4대보험', UNKNOWN, '가입 요건에 해당하면 사업주는 가입 의무가 있습니다.', 'caution')],
    }
  }
  return {
    title: '사회보험',
    lines: Object.entries(INSURANCE_LABELS).map(([key, label]) =>
      si[key] === true
        ? line(label, '적용', null, 'ok')
        : si[key] === false
          ? line(label, '적용하지 않음', '가입 요건에 해당하면 사업주는 가입 의무가 있습니다.', 'caution')
          : line(label, UNKNOWN, null, 'caution')
    ),
  }
}

// 근로자가 서명 전에 직접 확인하면 좋을 것들. 계약서에서 알 수 없는 것을 묻게 한다.
function checklist(terms, sections) {
  const items = []
  const cautions = sections.flatMap((s) => s.lines.filter((l) => l.tone === 'caution'))

  if (cautions.length > 0) {
    items.push(`위에서 노란색으로 표시된 ${cautions.length}가지를 회사에 확인해보세요.`)
  }
  if (!terms?.wagePayMethod) items.push('임금을 어떤 방법으로 받는지 확인해보세요.')
  const weekly = computeWeeklyHours(terms)
  if (weekly !== null && weekly > 40) {
    items.push('법정 근로시간을 넘는 부분에 가산수당이 어떻게 지급되는지 확인해보세요.')
  }
  items.push('계약서에 적힌 내용과 면접에서 들은 내용이 같은지 다시 비교해보세요.')
  items.push('서명한 계약서 사본을 받아 보관하세요. 사업주에게는 교부 의무가 있습니다.')

  return { title: '서명 전에 확인할 것', lines: items.map((text) => line('', text, null, 'info')) }
}

// terms: 카멜 표기 계약 조건
export function explainContract(terms, now = new Date()) {
  const sections = [
    wageSection(terms),
    hoursSection(terms),
    periodSection(terms, now),
    restSection(terms),
    insuranceSection(terms),
  ]
  sections.push(checklist(terms, sections))

  const cautionCount = sections.reduce(
    (n, s) => n + s.lines.filter((l) => l.tone === 'caution').length,
    0
  )

  return {
    sections,
    cautionCount,
    summary:
      cautionCount === 0
        ? '계약서에 적힌 내용에서 확인이 필요한 항목이 없습니다.'
        : `확인이 필요한 항목이 ${cautionCount}가지 있습니다. 아래에서 노란색으로 표시했습니다.`,
  }
}
