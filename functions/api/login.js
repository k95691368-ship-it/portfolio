import { verifyPassword, createSession, sessionCookieHeader, normalizeEmail } from '../_lib/auth.js'
import { jsonResponse, jsonError } from '../_lib/http.js'
import { checkRateLimit, releaseRateLimit } from '../_lib/rateLimit.js'

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null)
  if (!body?.email || !body?.password) {
    return jsonError('이메일과 비밀번호를 입력해주세요.', 400)
  }

  // 시도 제한을 두 축으로 건다.
  //
  // IP 만 세면 한 계정을 여러 곳에서 두드리는 것을 못 막는다. 요즘은 IP 를
  // 바꿔 가며 두드리는 것이 어렵지 않고, 그러면 한 사람의 비밀번호는 사실상
  // 무제한으로 시도된다. 그 계정 안에는 서명한 근로계약서가 들어 있다.
  //
  // 반대로 계정만 세면 한 IP 가 여러 계정을 훑는 것을 못 막는다. 둘 다 센다.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const email = normalizeEmail(body.email)
  const tooBusy = '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.'

  const byIp = await checkRateLimit(env, `login:${ip}`, 20, 600)
  if (!byIp) return jsonError(tooBusy, 429)

  // 계정 쪽은 더 좁게 잡는다. 사람이 자기 비밀번호를 10분에 열 번 넘게
  // 틀리는 일은 드물고, 넘겼다면 대개 사람이 아니다.
  const byAccount = await checkRateLimit(env, `login-acct:${email}`, 10, 600)
  if (!byAccount) return jsonError(tooBusy, 429)

  // 저장된 표기와 대소문자가 달라 로그인이 막히지 않도록 같은 규칙으로 맞춘다.
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first()
  if (!user) return jsonError('이메일 또는 비밀번호가 올바르지 않습니다.', 401)

  const valid = await verifyPassword(body.password, user.password_hash, user.password_salt)
  if (!valid) return jsonError('이메일 또는 비밀번호가 올바르지 않습니다.', 401)

  if (user.is_suspended) return jsonError('정지된 계정입니다. 관리자에게 문의해주세요.', 403)

  // 로그인 유지를 고르지 않았으면 브라우저를 닫을 때 끝난다.
  //
  // 값을 보내지 않는 호출부(예전 클라이언트, 검증 스크립트)는 예전처럼
  // 유지한다. 새 화면은 항상 명시해서 보낸다.
  const persistent = body.remember !== false
  const { token } = await createSession(env.DB, user.id, { persistent })

  // 성공한 로그인은 한도를 깎지 않는다.
  //
  // 막으려는 것은 맞히려는 시도이지 들어오는 사람이 아니다. 성공까지 세면
  // 기기를 여러 개 쓰는 사람이나 자주 드나드는 담당자가 자기 계정에서
  // 잠긴다 -- 공격자는 막지 못하면서 쓰는 사람만 막는 꼴이다.
  await Promise.all([
    releaseRateLimit(env, `login:${ip}`, byIp),
    releaseRateLimit(env, `login-acct:${email}`, byAccount),
  ]).catch(() => {})

  return jsonResponse(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.display_name,
      isAdmin: !!user.is_admin,
      isRecruiter: !!user.is_recruiter,
      isDeveloper: !!user.is_developer,
      mustChangePassword: !!user.must_change_password,
    },
    200,
    { 'Set-Cookie': sessionCookieHeader(token, { persistent }) }
  )
}
