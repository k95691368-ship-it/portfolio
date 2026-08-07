// 한국 달력 기준의 "오늘" (순수 함수 — 단위 테스트 대상).
//
// 서버는 UTC로 돈다. Workers 의 new Date() 도, D1 의 datetime('now') 도 UTC다.
// 그런데 이 서비스의 사용자는 한국(UTC+9)에 있고, 계약서에 적는 날짜는 전부
// 한국 달력의 날짜다.
//
// 그래서 한국시간 0시부터 9시까지 아홉 시간 동안, 서버가 보는 "오늘"은 사용자가
// 보는 "어제"다. 이 어긋남이 날짜 비교에 그대로 들어가면:
//
//   - 근로관계 종료일에 오늘 날짜를 넣으면 "아직 오지 않은 날짜"라며 거부된다.
//     새벽에 일하는 사람은 그 아홉 시간 동안 오늘을 기록할 수 없다.
//   - 계약 만료일 당일에도 "만료 1일 전"으로 표시된다.
//   - 연차가 오늘 발생했는데 "다음 발생"으로 여전히 오늘이 뜬다.
//   - 보존 기간이 오늘 끝났는데 아직 남은 것으로 계산된다.
//
// 날짜만 비교하는 자리에서는 반드시 이 함수를 쓴다. 시각까지 다루는 자리
// (감사추적 타임스탬프 등)는 UTC 그대로 둔다 — 그쪽은 순서만 맞으면 된다.

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000

// 한국 달력으로 오늘에 해당하는 날짜를, UTC 자정 Date 로 돌려준다.
// parseContractDate 가 만드는 값과 같은 형태라 그대로 비교할 수 있다.
export function koreanToday(now = new Date()) {
  const shifted = new Date(now.getTime() + KST_OFFSET_MS)
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
  )
}

// 한국 달력 날짜 문자열 (YYYY-MM-DD).
export function koreanDateString(now = new Date()) {
  return koreanToday(now).toISOString().slice(0, 10)
}
