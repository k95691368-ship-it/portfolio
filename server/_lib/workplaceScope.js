// 상시 근로자 수에 따라 어떤 조항이 적용되는가 (순수 함수 — 단위 테스트 대상).
//
// 근로기준법 제11조 제1항은 이 법을 상시 5명 이상 사업장에 적용한다고 정하고,
// 제2항과 시행령 제7조 별표1이 4명 이하 사업장에 적용할 규정을 따로 열거한다.
// 그 목록에서 빠진 것 중 이 앱이 판정하는 것은 셋이다.
//
//   제53조 연장근로 제한 (주 52시간)
//   제56조 연장·야간·휴일 가산수당
//   제60조 연차 유급휴가
//
// 반대로 제17조(근로조건 명시)·제54조(휴게)·제55조(주휴일)과 최저임금법·
// 퇴직급여법은 사업장 규모와 무관하게 적용된다. 이 구분을 지키지 않으면
// 두 방향으로 틀린다 — 적용되지 않는 조항으로 서명을 막거나, 발생하지 않는
// 권리를 근로자에게 확정 금액으로 약속하거나.

export const SMALL_WORKPLACE_THRESHOLD = 5

// 4명 이하 사업장에 적용되지 않는, 이 앱이 판정하는 조항들.
export const SIZE_DEPENDENT_LAWS = ['제53조', '제56조', '제60조']

export function workplaceScope(terms) {
  // 두 이름을 모두 읽는다.
  //
  // 이 함수는 카멜(employeeCount)만 읽고 있었다. 그런데 부르는 쪽이 갈린다 --
  // 서명 검사는 rowToCamelTerms 를 거친 값을 넘기지만, 채용내정·해고 안내는
  // DB 행을 그대로 넘긴다. 그래서 계약서에 상시 3명이라고 적어도 그 경로에서는
  // 값이 없는 것으로 읽혀, 4명 이하 사업장에 "부당해고 구제신청을 할 수 있다"고
  // 안내했다. 제23조도 제28조도 적용되지 않는 사업장에다 대고 한 말이다.
  //
  // 같은 종류의 사고가 이미 한 번 있었다. hireConfirmed / hire_confirmed 를
  // 한쪽만 읽어 채용내정 판정이 통째로 꺼졌다(jobOffer.js 참고). 이름이 두
  // 벌인 곳에서는 둘 다 읽는다.
  const raw = terms?.employeeCount ?? terms?.employee_count
  const n = raw === '' || raw === null || raw === undefined ? NaN : Number(raw)
  if (!Number.isFinite(n) || n < 1) {
    // 모르면 근로자에게 유리한 쪽으로 본다. 다만 그것이 전제라는 사실을
    // 감추지 않는다 — 감추면 4명 이하 사업장에 틀린 판정을 확신처럼 내민다.
    return { known: false, small: false, count: null }
  }
  const count = Math.round(n)
  return { known: true, small: count < SMALL_WORKPLACE_THRESHOLD, count }
}

// 규모를 모를 때 판정 옆에 함께 붙이는 단서.
export const UNKNOWN_SIZE_CAVEAT =
  '상시 5명 이상 사업장을 전제로 한 판정입니다. 상시 4명 이하라면 이 조항은 적용되지 않습니다(근로기준법 제11조·시행령 제7조 별표1). 계약서에 상시 근로자 수를 적으면 그에 맞게 판정합니다.'

// 4명 이하일 때 적용되지 않는다고 알리는 문구.
export function notApplicableReason(article, count) {
  return `상시 근로자 ${count}명(4명 이하) 사업장이라 ${article}가 적용되지 않습니다(근로기준법 제11조 제1항·시행령 제7조 별표1). 다만 제17조(근로조건 명시)·제54조(휴게)·제55조(주휴일)과 최저임금·퇴직급여는 그대로 적용됩니다.`
}
