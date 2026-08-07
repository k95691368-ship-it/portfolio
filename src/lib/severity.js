// 심각도를 색이 아니라 말로도 나타낸다 (순수 함수 — 단위 테스트 대상).
//
// 지금까지 심각도는 배지 색으로만 구분했다. 붉은색과 노란색을 구별하지 못하는
// 사람에게 "심각"과 "주의"는 똑같은 회색 조각으로 보인다. 화면을 읽어 주는
// 도구를 쓰는 사람에게는 아예 전달되지 않는다. 색이 사라지면 함께 사라지는
// 정보는, 전달했다고 말할 수 없다.
//
// 하필 이 배지가 붙는 자리가 서명 직전 법령 점검 화면이다. 무엇이 위법이고
// 무엇이 참고인지 구분하지 못한 채 서명하게 두는 것은, 점검을 하지 않은 것과
// 결과가 같다.

export const SEVERITY_WORD = { high: '심각', medium: '주의', info: '참고' }
export const SEVERITY_CLASS = {
  high: 'badge-danger',
  medium: 'badge-warning',
  info: 'badge-neutral',
}

// 모르는 값이 오면 가장 약한 쪽으로 읽는다. 없는 심각도를 지어내 겁주지 않는다.
export function severityWord(severity) {
  return SEVERITY_WORD[severity] ?? SEVERITY_WORD.info
}

export function severityClass(severity) {
  return SEVERITY_CLASS[severity] ?? SEVERITY_CLASS.info
}
