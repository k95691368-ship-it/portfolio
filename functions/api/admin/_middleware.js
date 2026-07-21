import { jsonError } from '../../_lib/http.js'

export async function onRequest({ data, next }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  if (!data.user.is_admin) return jsonError('관리자 권한이 필요합니다.', 403)
  return next()
}
