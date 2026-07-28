import { jsonResponse, jsonError } from '../../_lib/http.js'
import { loadMyRooms } from '../../_lib/dashboard.js'

export async function onRequestGet({ env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  return jsonResponse({ rooms: await loadMyRooms(env, data.user) })
}
