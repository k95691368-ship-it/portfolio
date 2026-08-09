import { jsonResponse } from '../_lib/http.js'
import {
  DEMO_DOMAIN,
  DEMO_PASSWORD,
  DEMO_ACCOUNTS,
  DEMO_WALKTHROUGH,
} from '../_lib/demoSeed.js'

// 공개: 체험용 데모가 살아 있는지와 그 접속 정보.
//
// 계정과 비밀번호를 공개로 내려주는 것은 의도한 것이다. 이 계정들은 사람의
// 계정이 아니라 시연을 위해 만들어 공개하는 것이므로, 감출 이유가 없고 감추면
// 쓸모가 없다. 다만 내려주는 목록은 코드에 박힌 데모 계정으로 한정한다 —
// DB에서 긁어오면 언젠가 사람의 계정이 섞여 나간다.
//
// 심어져 있지 않으면 seeded:false 만 돌려준다. 없는 계정을 안내하는 것이
// 안내가 없는 것보다 나쁘다.
// 이 엔드포인트는 첫 화면이 열릴 때마다 불린다. 이 앱에서 가장 자주 불리는
// 경로이므로 한 번의 조회로 끝낸다 — 예전에는 개수와 발급번호를 따로 물어
// 방문자마다 왕복이 두 번이었다.
export async function onRequestGet({ env }) {
  const like = `%@${DEMO_DOMAIN}`
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM users WHERE email LIKE ?1) AS accounts,
            (SELECT COUNT(*) FROM job_postings p
               JOIN users u ON u.id = p.created_by_user_id
              WHERE u.email LIKE ?1 AND p.status = 'open') AS postings,
            (SELECT c.serial FROM audit_certificates c
               JOIN room_participants rp ON rp.room_id = c.room_id
               JOIN users u ON u.id = rp.user_id
              WHERE u.email LIKE ?1
              ORDER BY c.issued_at DESC LIMIT 1) AS serial`
  )
    .bind(like)
    .first()

  if ((row?.accounts ?? 0) < DEMO_ACCOUNTS.length) return jsonResponse({ seeded: false })

  return jsonResponse({
    seeded: true,
    password: DEMO_PASSWORD,
    postings: row?.postings ?? 0,
    certificateSerial: row?.serial ?? null,
    accounts: DEMO_ACCOUNTS.map((a) => ({
      email: a.email,
      role: a.role,
      displayName: a.displayName,
    })),
    // 안내 문구는 방 제목과 같은 곳에서 나온다. 화면이 따로 적어 두면
    // 제목을 고쳤을 때 안내만 옛 이름을 가리킨다.
    walkthrough: DEMO_WALKTHROUGH,
  })
}
