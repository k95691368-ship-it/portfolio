// 근로자가 실제로 갖는 권리를 날짜와 금액으로 계산한다 (순수 함수 — 단위 테스트 대상).
//
// 계약서에는 "연차유급휴가: 근로기준법에 따름", "퇴직급여: 법에 따라 지급"이라고
// 적힌다. 틀린 말은 아니지만 근로자는 이 문장에서 아무것도 알 수 없다. 며칠이
// 생기는지, 언제 생기는지, 내가 퇴직금 대상인지, 연장근로 한 시간에 얼마를
// 받아야 하는지 — 계약서에 적힌 값만으로 전부 계산할 수 있는데 아무도 계산해
// 주지 않는다.
//
// 이 계산은 결정론적이다. 같은 계약이면 언제나 같은 답이 나와야 하고, 근로자가
// 이 숫자를 근거로 회사에 물을 수 있어야 하므로 AI에 맡기지 않는다.

import { computeWeeklyHours, monthlyPaidHours } from './contractCheck.js'
import { parseContractDate } from './contractPeriod.js'
import { effectiveWageItems } from './wageItems.js'

// 근로기준법 제18조 제3항: 4주 평균 1주 소정근로시간이 15시간 미만인 근로자에게는
// 제55조(주휴)와 제60조(연차)를 적용하지 않는다.
export const SHORT_TIME_WEEKLY_HOURS = 15

export const BASE_ANNUAL_LEAVE_DAYS = 15 // 제60조 제1항
export const MAX_ANNUAL_LEAVE_DAYS = 25 // 제60조 제4항 한도

// 근속 연수에 따른 연차 일수.
//
// 제60조 제4항: "3년 이상 계속하여 근로한 근로자에게는 제1항에 따른 휴가에
// 최초 1년을 초과하는 계속 근로 연수 매 2년에 대하여 1일을 가산한 유급휴가를
// 주어야 한다. 이 경우 가산휴가를 포함한 총 휴가 일수는 25일을 한도로 한다."
//
// 3년차부터 가산이 시작되고 2년마다 1일씩 늘어난다. 1~2년차 15일, 3~4년차 16일,
// 5~6년차 17일 … 21년차 이후 25일.
export function annualLeaveDaysForYear(serviceYears) {
  if (!Number.isFinite(serviceYears) || serviceYears < 1) return 0
  if (serviceYears < 3) return BASE_ANNUAL_LEAVE_DAYS
  const added = Math.floor((serviceYears - 1) / 2)
  return Math.min(BASE_ANNUAL_LEAVE_DAYS + added, MAX_ANNUAL_LEAVE_DAYS)
}

// 연차가 언제 몇 개 생기는지.
export function describeAnnualLeave(terms, now = new Date()) {
  const start = parseContractDate(terms?.contractStartDate)
  const weekly = computeWeeklyHours(terms)

  if (weekly !== null && weekly < SHORT_TIME_WEEKLY_HOURS) {
    return {
      known: true,
      applies: false,
      reason: `1주 소정근로시간이 ${weekly}시간으로 15시간 미만입니다. 근로기준법 제18조 제3항에 따라 연차 유급휴가와 주휴일이 적용되지 않습니다.`,
    }
  }
  if (!start) return { known: false }

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const anniversary = (n) =>
    new Date(Date.UTC(start.getUTCFullYear() + n, start.getUTCMonth(), start.getUTCDate()))

  // 만 1년이 되기 전에는 1개월 개근마다 1일씩, 최대 11일 (제60조 제2항).
  const firstYear = []
  for (let m = 1; m <= 11; m += 1) {
    firstYear.push({
      at: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, start.getUTCDate()))
        .toISOString()
        .slice(0, 10),
      days: 1,
      cumulative: m,
    })
  }

  // 만 1년부터는 근속 연수에 따라 한 번에 발생한다.
  const byYear = []
  for (let y = 1; y <= 5; y += 1) {
    byYear.push({
      at: anniversary(y).toISOString().slice(0, 10),
      serviceYears: y,
      days: annualLeaveDaysForYear(y),
    })
  }

  // 오늘 기준으로 다음에 생길 연차.
  const upcoming =
    firstYear.find((f) => new Date(f.at) > today) ?? byYear.find((b) => new Date(b.at) > today) ?? null

  return {
    known: true,
    applies: true,
    startDate: start.toISOString().slice(0, 10),
    firstYear,
    byYear,
    upcoming,
    summary:
      '입사 후 1년이 되기 전에는 1개월을 개근할 때마다 1일씩(최대 11일), 1년이 되는 날부터는 15일이 한 번에 생깁니다. 3년째부터 2년마다 1일씩 늘어 최대 25일까지입니다.',
    law: '근로기준법 제60조',
  }
}

// 퇴직금을 받을 수 있는가 (근로자퇴직급여 보장법 제4조 제1항 단서).
//
// 계속근로기간 1년 미만이거나, 4주 평균 1주 소정근로시간이 15시간 미만이면
// 퇴직급여제도 설정 의무에서 제외된다.
export function describeSeverance(terms, now = new Date()) {
  const start = parseContractDate(terms?.contractStartDate)
  const end = parseContractDate(terms?.contractEndDate)
  const weekly = computeWeeklyHours(terms)

  if (weekly !== null && weekly < SHORT_TIME_WEEKLY_HOURS) {
    return {
      known: true,
      eligible: false,
      reason: `1주 소정근로시간이 ${weekly}시간으로 15시간 미만이라 퇴직급여 대상이 아닙니다.`,
      law: '근로자퇴직급여 보장법 제4조 제1항',
    }
  }
  if (!start) return { known: false }

  // 계약 기간만으로 판단한다. 실제 계속근로는 갱신·계속 근무로 달라질 수 있다.
  const oneYear = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()))
  const reachesOneYear = !end || end.getTime() >= oneYear.getTime() - 24 * 60 * 60 * 1000

  return {
    known: true,
    eligible: reachesOneYear,
    qualifyingDate: oneYear.toISOString().slice(0, 10),
    reason: reachesOneYear
      ? `${oneYear.toISOString().slice(0, 10)}까지 계속 근무하면 퇴직금이 발생합니다. 계속근로 1년에 대하여 30일분 이상의 평균임금이 지급되어야 합니다.`
      : `계약 기간이 1년에 이르지 않아 이 계약만으로는 퇴직금이 발생하지 않습니다. 다만 계약이 갱신되어 계속근로가 1년을 넘으면 그때부터 대상이 됩니다.`,
    law: '근로자퇴직급여 보장법 제4조·제8조',
  }
}

// 통상임금으로 확실히 볼 수 있는 것만 더한다.
//
// 통상임금은 소정근로의 대가로 정기적·일률적·고정적으로 지급하는 금품이다.
// 기본급과 매월 고정수당은 다툼의 여지가 적지만, 식대 같은 복리후생비나 상여금은
// 지급 조건에 따라 포함 여부가 갈린다. 여기서는 확실한 것만 넣어 하한을 내고,
// 실제로는 더 높을 수 있다는 사실을 함께 밝힌다. 근로자에게 보여 주는 숫자를
// 실제보다 높게 잡아 "이만큼 받을 수 있다"고 말하는 것이 더 나쁘다.
const ORDINARY_TYPES = new Set(['base', 'fixed_allowance'])

export function ordinaryWageBase(terms) {
  return effectiveWageItems(terms)
    .filter((i) => ORDINARY_TYPES.has(i.type))
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0)
}

// 연장·야간·휴일근로 가산 (근로기준법 제56조).
export function describeOvertimeRates(terms) {
  const weekly = computeWeeklyHours(terms)
  const ordinary = ordinaryWageBase(terms)
  if (weekly === null || !(ordinary > 0)) return { known: false }

  const hours = monthlyPaidHours(weekly)
  if (!(hours > 0)) return { known: false }

  const hourly = Math.round(ordinary / hours)
  const items = effectiveWageItems(terms)
  const hasUncertain = items.some((i) => !ORDINARY_TYPES.has(i.type) && Number(i.amount) > 0)

  return {
    known: true,
    ordinaryMonthly: ordinary,
    monthlyHours: Math.round(hours),
    hourly,
    rates: [
      { name: '연장근로', multiplier: 1.5, perHour: Math.round(hourly * 1.5), law: '제56조 제1항' },
      { name: '야간근로 (22시~06시)', multiplier: 0.5, perHour: Math.round(hourly * 0.5), law: '제56조 제3항', note: '가산분만 계산한 금액입니다' },
      { name: '휴일근로 (8시간 이내)', multiplier: 1.5, perHour: Math.round(hourly * 1.5), law: '제56조 제2항' },
      { name: '휴일근로 (8시간 초과분)', multiplier: 2.0, perHour: Math.round(hourly * 2), law: '제56조 제2항' },
    ],
    caveat: hasUncertain
      ? '통상시급은 기본급과 매월 고정수당만으로 계산한 값입니다. 식대·상여금처럼 매월 일률적으로 지급되는 금품이 통상임금에 포함되면 실제 가산수당은 이보다 높아집니다.'
      : null,
    law: '근로기준법 제56조',
  }
}

export function describeWorkerRights(terms, now = new Date()) {
  if (!terms) return null
  return {
    annualLeave: describeAnnualLeave(terms, now),
    severance: describeSeverance(terms, now),
    overtime: describeOvertimeRates(terms),
  }
}
