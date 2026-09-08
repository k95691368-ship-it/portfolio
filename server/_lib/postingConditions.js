// 공고에 적는 근로조건의 검증·정규화 (순수 함수 — 단위 테스트 대상).
//
// 공고에 제시한 조건은 나중에 계약서와 대조된다(채용절차법 제4조 제3항). 그래서
// 값이 들어올 때 형식을 맞춰 두어야 대조가 가능하다. 다만 모든 항목이 선택이다 —
// 조건을 적지 않는 공고를 막지는 않고, 적지 않으면 대조하지 않는다.

export const WAGE_TYPES = ['monthly', 'hourly', 'annual']

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/
const SHORT_MAX = 100

function toAmount(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(String(value).replace(/[,\s원]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

// { wageType, wageMin, wageMax, workHoursStart, workHoursEnd, workDays, error }
export function normalizePostingConditions(body) {
  const wageType = WAGE_TYPES.includes(body?.wageType) ? body.wageType : null
  const wageMin = toAmount(body?.wageMin)
  const wageMax = toAmount(body?.wageMax)
  const workHoursStart = (body?.workHoursStart || '').toString().trim()
  const workHoursEnd = (body?.workHoursEnd || '').toString().trim()
  const workDays = (body?.workDays || '').toString().trim().slice(0, SHORT_MAX)

  if ((wageMin || wageMax) && !wageType) {
    return { error: '임금을 적으려면 월급·시급·연봉 중 하나를 선택해주세요.' }
  }
  if (wageType && !wageMin) {
    return { error: '임금 종류를 선택했으면 최소 금액을 입력해주세요.' }
  }
  if (wageMin && wageMax && wageMax < wageMin) {
    return { error: '임금 상한이 하한보다 작습니다.' }
  }
  if (workHoursStart && !TIME_RE.test(workHoursStart)) {
    return { error: '근무 시작 시각은 09:00 같은 형식으로 입력해주세요.' }
  }
  if (workHoursEnd && !TIME_RE.test(workHoursEnd)) {
    return { error: '근무 종료 시각은 18:00 같은 형식으로 입력해주세요.' }
  }
  // 한쪽만 적으면 근로시간을 계산할 수 없어 대조에 쓰이지 못한다.
  if ((workHoursStart && !workHoursEnd) || (!workHoursStart && workHoursEnd)) {
    return { error: '근무 시각은 시작과 종료를 함께 입력해주세요.' }
  }

  return {
    error: null,
    wageType,
    wageMin: wageMin ?? null,
    wageMax: wageMax ?? null,
    workHoursStart: workHoursStart || null,
    workHoursEnd: workHoursEnd || null,
    workDays: workDays || null,
  }
}

// DB 행 → 응답용 카멜 표기
export function postingConditionsFromRow(row) {
  return {
    wageType: row?.wage_type ?? null,
    wageMin: row?.wage_min ?? null,
    wageMax: row?.wage_max ?? null,
    workHoursStart: row?.work_hours_start ?? null,
    workHoursEnd: row?.work_hours_end ?? null,
    workDays: row?.work_days ?? null,
  }
}
