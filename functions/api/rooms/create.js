import { genId } from '../../_lib/db.js'
import { jsonResponse, jsonError } from '../../_lib/http.js'

function genInviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 헷갈리는 글자(0/O, 1/I) 제외
  let code = ''
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  for (const b of bytes) code += alphabet[b % alphabet.length]
  return code
}

export async function onRequestPost({ request, env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  if (data.user.role !== 'company') return jsonError('회사 계정만 면접방을 만들 수 있습니다.', 403)

  const body = await request.json().catch(() => null)
  const title = body?.title?.trim()
  if (!title) return jsonError('면접방 제목을 입력해주세요.', 400)

  const id = genId()

  // 초대코드는 invite_code UNIQUE 제약이 이미 막아 준다. 미리 조회해 보는 것은
  // 왕복을 늘리면서도 정확하지 않다 — 두 요청이 같은 코드로 동시에 "없음"을
  // 확인한 뒤 나란히 INSERT할 수 있다. 그래서 넣어 보고 충돌하면 다시 뽑는다.
  let inviteCode = genInviteCode()
  for (let attempt = 0; ; attempt += 1) {
    try {
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO interview_rooms (id, company_user_id, title, invite_code) VALUES (?, ?, ?, ?)'
        ).bind(id, data.user.id, title, inviteCode),
        env.DB.prepare(
          'INSERT INTO room_participants (room_id, user_id, role_in_room) VALUES (?, ?, ?)'
        ).bind(id, data.user.id, 'company'),
      ])
      break
    } catch (err) {
      const collided = String(err?.message || err).includes('UNIQUE')
      if (!collided || attempt >= 4) {
        console.error(`Room create failed (user ${data.user.id}):`, err)
        return jsonError('면접방 생성에 실패했습니다. 잠시 후 다시 시도해주세요.', 500)
      }
      inviteCode = genInviteCode()
    }
  }

  return jsonResponse({ id, title, inviteCode, status: 'open' }, 201)
}
