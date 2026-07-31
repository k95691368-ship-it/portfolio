import { jsonResponse, jsonError } from '../../_lib/http.js'
import { loadMyApplications } from '../../_lib/dashboard.js'

// 로그인한 사용자가 자기 지원서를 모아 본다.
export async function onRequestGet({ env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  return jsonResponse({ applications: await loadMyApplications(env, data.user) })
}
