import { notifyUser } from './notify.js'

// 서명 후 계약 내용이 바뀌면 기존 서명을 무효화한다.
//
// 계약 내용을 잠그는 조건이 "양측 서명 완료"뿐이라, 한쪽만 서명한 상태에서는
// 조건과 본문을 자유롭게 바꿀 수 있었다. 그러면 먼저 서명한 사람은 자기가 본
// 적 없는 내용에 서명한 것이 된다. 서로 합의한 내용이 없는 계약이므로, 내용이
// 바뀌는 순간 그 전에 받은 서명은 더 이상 동의가 아니다.
//
// 변경을 막지 않고 서명을 무효화하는 쪽을 택한 이유: 오타를 고치려는 정상적인
// 수정까지 막으면 계약을 처음부터 다시 만들어야 한다. 대신 무엇이 왜 무효가
// 되었는지 남기고 다시 서명받게 한다.
export async function revokeSignaturesOnChange(env, roomId, { actorUserId, reason }) {
  const { results: signatures } = await env.DB.prepare(
    `SELECT signer_role, signer_user_id, signed_at, signer_ip, signer_user_agent,
            signer_country, document_sha256
       FROM signatures WHERE room_id = ?`
  )
    .bind(roomId)
    .all()

  if (signatures.length === 0) return { revoked: 0, roles: [] }

  const statements = signatures.map((s) =>
    env.DB.prepare(
      `INSERT INTO signature_revocations
         (room_id, signer_role, signer_user_id, signed_at, signer_ip, signer_user_agent,
          signer_country, document_sha256, revoked_by_user_id, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      roomId,
      s.signer_role,
      s.signer_user_id,
      s.signed_at,
      s.signer_ip,
      s.signer_user_agent,
      s.signer_country,
      // 무효가 된 서명이 어떤 문서에 붙어 있었는지도 남긴다.
      s.document_sha256 ?? null,
      actorUserId ?? null,
      reason
    )
  )
  statements.push(env.DB.prepare('DELETE FROM signatures WHERE room_id = ?').bind(roomId))
  // 양측 서명 완료로 잠겨 있었다면 다시 서명 단계로 되돌린다.
  statements.push(
    env.DB.prepare(
      "UPDATE interview_rooms SET status = 'contract_pending' WHERE id = ? AND status = 'signed'"
    ).bind(roomId)
  )
  await env.DB.batch(statements)

  // 무효화된 사람에게 알린다. 모르고 있으면 다시 서명할 이유를 알 수 없다.
  for (const s of signatures) {
    if (!s.signer_user_id || s.signer_user_id === actorUserId) continue
    await notifyUser(env, s.signer_user_id, {
      type: 'signature_revoked',
      message: '서명 후 계약 내용이 변경되어 기존 서명이 무효화되었습니다. 내용을 다시 확인하고 서명해주세요.',
      link: `/rooms/${roomId}/contract`,
    })
  }

  return { revoked: signatures.length, roles: signatures.map((s) => s.signer_role) }
}
