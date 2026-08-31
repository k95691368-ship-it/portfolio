import { jsonResponse, jsonError } from '../../_lib/http.js'
import { createSession, sessionCookieHeader } from '../../_lib/auth.js'
import { checkRateLimit } from '../../_lib/rateLimit.js'
import { DEMO_DOMAIN, DEMO_ACCOUNTS } from '../../_lib/demoSeed.js'

// 공개: 버튼 한 번으로 체험 계정에 로그인한다.
//
// 계정과 비밀번호를 화면에 적어 두었지만, 보러 온 사람에게 그것을 옮겨 적게
// 하는 것은 문 앞에 열쇠를 걸어 두고 "직접 꽂으세요"라고 하는 것과 같다.
// 대부분은 그 자리에서 그만둔다.
//
// 다만 이 경로는 비밀번호 없이 세션을 만들어 준다. 이 앱에서 가장 위험한
// 문이므로, 열 수 있는 대상을 코드가 못박는다.
//
//   화면은 이메일을 보내지 않는다. '회사'인지 '지원자'인지만 보낸다.
//   그 말이 어느 계정을 뜻하는지는 서버가 코드에 박힌 목록에서 고른다.
//   이메일을 받으면 언젠가 사람의 계정 주소가 들어오고, 그때 이 문은
//   비밀번호 없이 남의 계정을 여는 문이 된다.
//
//   고른 계정이 정말 체험용인지 한 번 더 확인한다. 목록이 잘못 고쳐지거나
//   같은 주소로 사람이 가입하는 일이 생겨도, 도메인이 다르면 열지 않는다.
//
//   심어져 있지 않으면 열지 않는다. 예시안을 지운 상태에서 이 문만 살아
//   있으면, 나중에 누군가 그 주소로 계정을 만들었을 때 열린다.

// 한 IP 가 짧은 시간에 세션을 무한히 찍어내지 못하게 한다. 사람이 체험하려고
// 누르는 횟수로는 넉넉하다.
const PER_HOUR = 30

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const allowed = await checkRateLimit(env, `demo-login:${ip}`, PER_HOUR, 3600)
  if (!allowed) return jsonError('체험 시작 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)

  const body = await request.json().catch(() => null)
  const wanted = String(body?.role ?? 'company')

  // 화면이 말한 역할을 코드에 박힌 목록에서 찾는다. 바깥에서 온 문자열이
  // 계정을 직접 가리키는 일이 없어야 한다.
  const account = DEMO_ACCOUNTS.find((a) => a.key === wanted) ?? DEMO_ACCOUNTS.find((a) => a.role === wanted)
  if (!account) return jsonError('체험할 수 있는 역할이 아닙니다.', 400)

  // 두 번째 잠금장치. 목록이 잘못 고쳐져도 체험용 주소가 아니면 열지 않는다.
  if (!account.email.endsWith(`@${DEMO_DOMAIN}`)) {
    return jsonError('체험 계정이 아닙니다.', 400)
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
    .bind(account.email)
    .first()
  if (!user) return jsonError('체험용 예시가 준비되어 있지 않습니다.', 404)

  // 세 번째. DB 에서 읽어 온 것이 정말 그 계정인지 본다.
  if (!String(user.email).endsWith(`@${DEMO_DOMAIN}`)) {
    return jsonError('체험 계정이 아닙니다.', 400)
  }
  if (user.is_suspended) return jsonError('체험 계정이 잠겨 있습니다.', 403)

  // 체험은 잠깐 둘러보는 일이다. 30일짜리 로그인을 남기지 않는다 --
  // 공용 컴퓨터에서 눌러 보고 떠난 사람의 세션이 계속 살아 있으면 곤란하다.
  const { token } = await createSession(env.DB, user.id, { persistent: false })

  return jsonResponse(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.display_name,
      isAdmin: !!user.is_admin,
      isRecruiter: !!user.is_recruiter,
      isDeveloper: !!user.is_developer,
      mustChangePassword: false,
      demo: true,
    },
    200,
    { 'Set-Cookie': sessionCookieHeader(token, { persistent: false }) }
  )
}
