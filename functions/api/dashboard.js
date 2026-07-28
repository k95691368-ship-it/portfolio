import { jsonResponse, jsonError } from '../_lib/http.js'
import { loadMyRooms, loadMyApplications } from '../_lib/dashboard.js'

// 로그인 직후 첫 화면이 필요한 것을 한 번에 돌려준다.
//
// 면접방 목록과 내 지원 현황을 따로 요청하면 로그인하자마자 두 번 나가고,
// 요청마다 세션 인증을 다시 한다. 알림은 이 화면 말고도 여러 곳에서 쓰이고
// 주기적으로 다시 확인해야 하므로 여기 넣지 않고 그대로 둔다.
export async function onRequestGet({ env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const [rooms, applications] = await Promise.all([
    // 관리자는 모든 면접방을 보는 별도 화면을 쓰므로 여기서는 본인 것만 읽는다.
    loadMyRooms(env, data.user),
    loadMyApplications(env, data.user),
  ])

  return jsonResponse({ rooms, applications })
}
