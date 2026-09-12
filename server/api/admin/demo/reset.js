import { jsonError } from '../../../_lib/http.js'

// Old clients must not recreate retired sample accounts or contracts.
export function onRequestPost() {
  return jsonError('기존 공유 예시 초기화 기능은 종료되었습니다. 홈에서 1시간 체험을 시작해주세요.', 410)
}
export const onRequestDelete = onRequestPost
export const onRequestGet = onRequestPost
