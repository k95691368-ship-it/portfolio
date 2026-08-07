import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { blockedWhenClosed } from '../../../_lib/roomLifecycle.js'
import { draftContractDocument } from '../../../_lib/claude.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import { revokeSignaturesOnChange } from '../../../_lib/signatureLock.js'

export async function onRequestPost({ env, data, params, request }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('계약서는 회사(고용) 측만 작성할 수 있습니다.', 403)
  }

  if (!data.user.is_admin && !data.user.is_recruiter) {
    return jsonError('근로계약서 자동완성은 채용자 또는 관리자 권한이 있는 계정만 사용할 수 있습니다.', 403)
  }

  const room = await env.DB.prepare('SELECT status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  if (room.status === 'signed') return jsonError('이미 서명이 완료된 계약서는 다시 작성할 수 없습니다.', 409)
  const draftBlock = blockedWhenClosed(room, 'draft')
  if (draftBlock) return jsonError(draftBlock, 409)

  const bucket = `contract-draft:${params.roomId}`
  const ticket = await checkRateLimit(env, bucket, 5, 60)
  if (!ticket) return jsonError('너무 잦은 요청입니다. 잠시 후 다시 시도해주세요.', 429)

  let terms
  try {
    terms = await request.json()
  } catch {
    await releaseRateLimit(env, bucket, ticket)
    return jsonError('잘못된 요청입니다.', 400)
  }

  let document
  try {
    document = await draftContractDocument(env, terms)
  } catch (err) {
    // AI 호출이 실패한 것은 사용자가 무언가를 해낸 것이 아니다. 다시 시도할 수
    // 있어야 하므로 이 시도는 한도에서 빼 준다.
    await releaseRateLimit(env, bucket, ticket)
    return jsonError(err.message, 502)
  }

  await env.DB.prepare(
    `INSERT INTO contract_terms (room_id, ai_document_json) VALUES (?, ?)
     ON CONFLICT(room_id) DO UPDATE SET ai_document_json = excluded.ai_document_json, updated_at = datetime('now')`
  )
    .bind(params.roomId, JSON.stringify(document.articles))
    .run()

  // 서명하는 문서가 바뀌었으므로 그 전에 받은 서명은 무효다.
  const revocation = await revokeSignaturesOnChange(env, params.roomId, {
    actorUserId: data.user.id,
    reason: '계약서 본문 재작성',
  })

  return jsonResponse({ articles: document.articles, revokedSignatures: revocation.revoked })
}
