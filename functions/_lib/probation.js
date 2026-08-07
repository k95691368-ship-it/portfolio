// 수습기간 임금 감액 점검 (순수 함수 — 단위 테스트 대상).
//
// 수습은 "그동안은 좀 덜 줘도 된다"로 널리 오해된다. 실제로는 세 가지 조건을
// 모두 만족할 때만, 그것도 10%까지만 깎을 수 있다.
//
//   최저임금법 제5조 제2항 — 1년 이상의 기간을 정하여 근로계약을 체결하고
//   수습 중에 있는 근로자로서
//   같은 법 시행령 제3조 — 수습을 시작한 날부터 3개월 이내인 사람에 대하여
//   시간급 최저임금액에서 100분의 10을 뺀 금액을 최저임금액으로 한다.
//
// 그래서 "수습 6개월, 임금의 80%"는 두 곳에서 어긋난다. 기간이 3개월을 넘고,
// 감액 폭이 10%를 넘는다. 계약기간이 1년 미만이면 애초에 감액 자체가 안 된다.
//
// 이 앱은 이것을 AI 프롬프트에 한 줄 적어 두었을 뿐, 계산으로 확인하지 않았다.
// AI가 응답하지 않으면 아무도 잡지 못하고, 응답하더라도 매번 같은 판정이
// 나온다는 보장이 없다. 법정 한도는 값이 정해져 있으므로 코드로 옮긴다.

import { parseContractDate, monthsBetween } from './contractPeriod.js'
import { effectiveWageItems, minimumWageBase } from './wageItems.js'
import {
  MINIMUM_HOURLY_WAGE_2026,
  computeWeeklyHours,
  monthlyPaidHours,
} from './contractCheck.js'

export const PROBATION_MAX_MONTHS = 3 // 시행령 제3조
export const PROBATION_MIN_PAY_RATIO = 90 // 최저임금의 90% 이상
export const PROBATION_MIN_CONTRACT_MONTHS = 12 // 제5조 제2항: 1년 이상 계약

const MONTH_RE = /(\d+)\s*(?:개월|달)/
const DAY_RE = /(\d+)\s*일/
// 감액하지 않는다는 표현. 이걸 먼저 보지 않으면 "감액 없음"에서 숫자를 못 찾아
// 판정을 포기하게 된다.
const NO_REDUCTION_RE = /감액\s*(?:은|이)?\s*없|감액\s*하지\s*않|삭감\s*(?:은|이)?\s*없|동일\s*(?:하게)?\s*지급|전액\s*지급/
// "10% 감액"처럼 깎는 폭을 적은 경우. 지급률 표기보다 먼저 봐야 한다 —
// 안 그러면 10%만 준다는 뜻으로 읽힌다.
const REDUCTION_RE = /(\d{1,3})\s*%\s*(?:를|을)?\s*(?:감액|삭감|공제|차감)/
// "임금의 80% 지급"처럼 주는 비율을 적은 경우.
const PAY_RATIO_RE = /(\d{1,3})\s*%\s*(?:를|을)?\s*(?:지급|지불|적용)/
const BARE_PCT_RE = /(\d{1,3})\s*%/

function textOf(terms) {
  const custom = Array.isArray(terms?.customTerms) ? terms.customTerms : []
  return custom
    .filter((c) => /수습|시용/.test(`${c?.label ?? ''} ${c?.value ?? ''}`))
    .map((c) => `${c?.label ?? ''} ${c?.value ?? ''}`)
    .join(' ')
    .trim()
}

// 계약서에 적힌 수습 조건을 읽는다. 자유 입력이라 표기가 제각각이므로,
// 확실하게 읽히는 것만 값으로 돌려주고 나머지는 null로 둔다.
// 잘못 읽고 위반이라 단정하는 것이 못 읽고 넘어가는 것보다 나쁘다.
export function parseProbation(terms) {
  const text = textOf(terms)
  if (!text) return { found: false, months: null, payRatio: null, text: null }

  let months = null
  const m = text.match(MONTH_RE)
  if (m) months = Number(m[1])
  else {
    const d = text.match(DAY_RE)
    if (d) months = Math.round((Number(d[1]) / 30) * 10) / 10
  }

  let payRatio = null
  if (NO_REDUCTION_RE.test(text)) payRatio = 100
  else {
    const cut = text.match(REDUCTION_RE)
    if (cut) payRatio = 100 - Number(cut[1])
    else {
      const pay = text.match(PAY_RATIO_RE) || text.match(BARE_PCT_RE)
      if (pay) payRatio = Number(pay[1])
    }
  }
  if (payRatio !== null && (payRatio < 0 || payRatio > 100)) payRatio = null

  return { found: true, months, payRatio, text }
}

// 계약 기간이 1년 이상인가. 종료일이 없으면 기간의 정함이 없는 계약이므로
// 1년 이상으로 본다.
//
// 종료일도 일하는 날이다. "9월 1일 ~ 이듬해 8월 31일"은 11개월이 아니라 1년이다.
// 그대로 세면 가장 흔한 1년 계약이 11개월이 되어, 적법한 수습 감액에 "1년 미만
// 계약이라 감액할 수 없다"는 틀린 경고가 붙는다. 계속근로기간 계산에서 이미
// 같은 이유로 하루를 더해 세고 있다.
const DAY_MS = 24 * 60 * 60 * 1000

function contractMonths(terms) {
  const start = parseContractDate(terms?.contractStartDate)
  const end = parseContractDate(terms?.contractEndDate)
  if (!start) return null
  if (!end) return Infinity
  const months = monthsBetween(start, new Date(end.getTime() + DAY_MS))
  return months === null ? null : months
}

// 수습 중에 지급하기로 한 금액과, 법이 허용하는 하한을 나란히 계산한다.
// 금액이 없으면 비율만으로 판정한다.
function probationAmounts(terms, payRatio) {
  // 수습 감액도 최저임금과의 비교이므로 산입 대상 임금으로 따진다.
  const wage = minimumWageBase(effectiveWageItems(terms))
  const weekly = computeWeeklyHours(terms)
  if (!Number.isFinite(wage) || wage <= 0 || weekly === null) return null
  const hours = monthlyPaidHours(weekly)
  if (!(hours > 0)) return null

  const paid = Math.round((wage * payRatio) / 100)
  // 수습 근로자의 시간급 최저임금 = 최저시급의 90%
  const floor = Math.ceil((MINIMUM_HOURLY_WAGE_2026 * 0.9 * hours) / 10) * 10
  return { paid, floor, below: paid < floor }
}

export function checkProbationCompliance(terms) {
  const p = parseProbation(terms)
  if (!p.found) return []

  const issues = []
  const reduced = p.payRatio !== null && p.payRatio < 100

  if (reduced) {
    const months = contractMonths(terms)
    if (months !== null && months < PROBATION_MIN_CONTRACT_MONTHS) {
      issues.push({
        severity: 'high',
        title: '수습 감액 불가 계약',
        detail: `수습 기간 중 임금을 감액하려면 1년 이상의 기간을 정한 근로계약이어야 합니다(최저임금법 제5조 제2항). 이 계약은 약 ${months}개월이므로 수습을 이유로 임금을 깎을 수 없습니다.`,
      })
    }

    if (p.months !== null && p.months > PROBATION_MAX_MONTHS) {
      issues.push({
        severity: 'high',
        title: '수습 감액 기간 초과',
        detail: `감액이 허용되는 것은 수습을 시작한 날부터 3개월 이내입니다(최저임금법 시행령 제3조). 계약서에 적힌 수습 기간은 ${p.months}개월이라, 3개월이 지난 뒤에도 감액된 임금을 지급하면 최저임금 위반이 됩니다.`,
      })
    }
  }

  // 감액의 하한은 '계약 임금의 90%'가 아니라 '최저임금의 90%'다
  // (최저임금법 시행령 제3조).
  //
  // 지급률만 보고 90% 미만이면 위반이라고 하고 있었다. 그러면 기본급 400만원인
  // 계약이 수습 중 80%인 320만원을 주어도 — 최저임금 하한의 한참 위인데도 —
  // 위반으로 잡혀 서명이 막힌다. 법이 정한 것은 비율이 아니라 금액이므로,
  // 실제 지급액과 하한을 비교해 판정한다.
  if (reduced) {
    const amounts = probationAmounts(terms, p.payRatio)
    if (amounts?.below) {
      issues.push({
        severity: 'high',
        title: '수습 감액 한도 초과',
        detail: `수습 중이라도 최저임금의 90% 미만은 지급할 수 없습니다(최저임금법 시행령 제3조). 계약서에는 ${p.payRatio}% 지급으로 적혀 있어 이 근로시간에서 수습 중 지급액이 약 ${amounts.paid.toLocaleString('ko-KR')}원인데, 법이 허용하는 하한은 ${amounts.floor.toLocaleString('ko-KR')}원입니다.`,
      })
    } else if (!amounts && p.payRatio < PROBATION_MIN_PAY_RATIO) {
      // 임금이나 근무시간이 비어 있어 금액을 계산할 수 없다. 모르는 것을
      // 위반이라고 단정하지 않되, 확인해야 할 자리라는 것은 남긴다.
      issues.push({
        severity: 'medium',
        title: '수습 지급액 확인 필요',
        detail: `계약서에 수습 중 ${p.payRatio}% 지급으로 적혀 있습니다. 수습 중이라도 최저임금의 90% 이상을 지급해야 하는데(최저임금법 시행령 제3조), 임금 또는 근무시간이 비어 있어 실제 지급액을 계산할 수 없습니다. 두 값을 채우면 자동으로 판정합니다.`,
      })
    }
  }

  return issues
}
