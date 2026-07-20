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
  let inviteCode = genInviteCode()

  // 초대코드가 우연히 겹치는 경우를 대비한 재시도
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await env.DB.prepare('SELECT id FROM interview_rooms WHERE invite_code = ?')
      .bind(inviteCode)
      .first()
    if (!existing) break
    inviteCode = genInviteCode()
  }

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO interview_rooms (id, company_user_id, title, invite_code) VALUES (?, ?, ?, ?)'
    ).bind(id, data.user.id, title, inviteCode),
    env.DB.prepare(
      'INSERT INTO room_participants (room_id, user_id, role_in_room) VALUES (?, ?, ?)'
    ).bind(id, data.user.id, 'company'),
  ])

  return jsonResponse({ id, title, inviteCode, status: 'open' }, 201)
}
