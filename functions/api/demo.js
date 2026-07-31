import { jsonResponse } from '../_lib/http.js'
import { DEMO_DOMAIN, DEMO_PASSWORD, DEMO_ACCOUNTS } from '../_lib/demoSeed.js'

// 공개: 체험용 데모가 살아 있는지와 그 접속 정보.
//
// 계정과 비밀번호를 공개로 내려주는 것은 의도한 것이다. 이 계정들은 사람의
// 계정이 아니라 시연을 위해 만들어 공개하는 것이므로, 감출 이유가 없고 감추면
// 쓸모가 없다. 다만 내려주는 목록은 코드에 박힌 데모 계정으로 한정한다 —
// DB에서 긁어오면 언젠가 사람의 계정이 섞여 나간다.
//
// 심어져 있지 않으면 seeded:false 만 돌려준다. 없는 계정을 안내하는 것이
// 안내가 없는 것보다 나쁘다.
export async function onRequestGet({ env }) {
  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM users WHERE email LIKE ?1) AS accounts,
            (SELECT COUNT(*) FROM job_postings p
               JOIN users u ON u.id = p.created_by_user_id
              WHERE u.email LIKE ?1 AND p.status = 'open') AS postings`
  )
    .bind(`%@${DEMO_DOMAIN}`)
    .first()

  const seeded = (counts?.accounts ?? 0) >= DEMO_ACCOUNTS.length
  if (!seeded) return jsonResponse({ seeded: false })

  const cert = await env.DB.prepare(
    `SELECT c.serial FROM audit_certificates c
       JOIN room_participants rp ON rp.room_id = c.room_id
       JOIN users u ON u.id = rp.user_id
      WHERE u.email LIKE ?
      ORDER BY c.issued_at DESC LIMIT 1`
  )
    .bind(`%@${DEMO_DOMAIN}`)
    .first()

  return jsonResponse({
    seeded: true,
    password: DEMO_PASSWORD,
    postings: counts?.postings ?? 0,
    certificateSerial: cert?.serial ?? null,
    accounts: DEMO_ACCOUNTS.map((a) => ({
      email: a.email,
      role: a.role,
      displayName: a.displayName,
    })),
  })
}
