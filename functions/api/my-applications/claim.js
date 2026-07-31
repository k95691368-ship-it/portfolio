import { jsonResponse, jsonError } from '../../_lib/http.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'

// 접수번호로 지원서를 내 계정에 연결한다.
//
// 지원은 로그인 없이 할 수 있으므로, 나중에 계정을 만든 사람은 자기 지원서를
// 계정에서 볼 방법이 필요하다. 예전에는 "계정 이메일이 지원서 이메일과 같으면
// 본인"으로 보았는데, 이 서비스에는 이메일 소유 확인이 없어서 남의 이메일로
// 가입하기만 하면 그 사람의 전형 상태와 접수번호가 보였다.
//
// 접수번호는 지원한 본인에게만 발급된다. 그것을 제시하는 것이 이메일을 아는
// 것보다 훨씬 나은 증거다.
//
// 이미 다른 계정에 연결된 지원서는 다시 가져가지 못한다. 먼저 연결한 쪽이
// 본인이 아닐 수도 있지만, 나중에 온 쪽이 본인이라는 증거도 접수번호뿐이라
// 여기서 판단할 수 없다. 관리자에게 넘긴다.
export async function onRequestPost({ request, env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  // 접수번호를 무차별로 넣어 보는 것을 막는다.
  const ticket = await checkRateLimit(env, `claim:${data.user.id}`, 10, 600)
  if (!ticket) return jsonError('시도가 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)

  const body = await request.json().catch(() => null)
  const code = String(body?.code ?? '')
    .trim()
    .toUpperCase()
  if (!code) return jsonError('접수번호를 입력해주세요.', 400)

  const application = await env.DB.prepare(
    'SELECT id, created_user_id, applicant_name FROM applications WHERE lookup_code = ?'
  )
    .bind(code)
    .first()

  if (!application) return jsonError('그 접수번호로 접수된 지원서가 없습니다.', 404)
  if (application.created_user_id === data.user.id) {
    return jsonResponse({ ok: true, alreadyLinked: true })
  }
  if (application.created_user_id) {
    return jsonError('이 지원서는 이미 다른 계정에 연결되어 있습니다. 담당자에게 문의해주세요.', 409)
  }

  // 그 사이에 누가 먼저 가져갔으면 여기서 0건이 되어 조용히 실패한다.
  const claimed = await env.DB.prepare(
    'UPDATE applications SET created_user_id = ? WHERE id = ? AND created_user_id IS NULL'
  )
    .bind(data.user.id, application.id)
    .run()

  if (claimed.meta.changes === 0) {
    return jsonError('이 지원서는 이미 다른 계정에 연결되어 있습니다. 담당자에게 문의해주세요.', 409)
  }

  return jsonResponse({ ok: true, applicantName: application.applicant_name })
}
