import { genId } from '../../_lib/db.js'
import { jsonResponse, jsonError } from '../../_lib/http.js'
import { genInviteCode } from '../../_lib/inviteCode.js'
import { runCreateOperation } from '../../_lib/createOperation.js'

export async function onRequestPost({ request, env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  if (data.user.role !== 'company') return jsonError('회사 계정만 면접방을 만들 수 있습니다.', 403)

  const body = await request.json().catch(() => null)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title) return jsonError('면접방 제목을 입력해주세요.', 400)
  if (title.length > 200) return jsonError('면접방 제목은 200자 이하로 입력해주세요.', 400)

  return runCreateOperation({
    env, userId: data.user.id, kind: 'room', operationId: body?.operationId,
    payload: [title],
    create: scopedEnv => createRoom(scopedEnv, data.user.id, title),
    recover: async (scopedEnv, resourceId) => {
      const room = await scopedEnv.DB.prepare('SELECT id, company_user_id, title, invite_code, status FROM interview_rooms WHERE id = ?')
        .bind(resourceId).first()
      if (!room) return jsonError('이 요청으로 만든 면접방은 삭제되었습니다. 다시 생성하지 않았습니다.', 410)
      if (room.company_user_id !== data.user.id) return jsonError('이 면접방에 접근할 권한이 없습니다.', 403)
      return jsonResponse({ id: room.id, title: room.title, inviteCode: room.invite_code, status: room.status, recovered: true })
    },
  })
}

async function createRoom(env, userId, title) {
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
        ).bind(id, userId, title, inviteCode),
        env.DB.prepare(
          'INSERT INTO room_participants (room_id, user_id, role_in_room) VALUES (?, ?, ?)'
        ).bind(id, userId, 'company'),
      ])
      break
    } catch (err) {
      const collided = String(err?.message || err).includes('UNIQUE')
      if (!collided || attempt >= 4) {
        console.error(`Room create failed (user ${userId}):`, err)
        return jsonError('면접방 생성에 실패했습니다. 잠시 후 다시 시도해주세요.', 500)
      }
      inviteCode = genInviteCode()
    }
  }

  return jsonResponse({ id, title, inviteCode, status: 'open' }, 201)
}
