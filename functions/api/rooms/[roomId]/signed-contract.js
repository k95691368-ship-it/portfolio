import { genId } from '../../../_lib/db.js'
import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import {
  maskEmail,
  isEmailConfigured,
  sendSignedContractEmail,
  arrayBufferToBase64,
} from '../../../_lib/email.js'
import { notifyUser } from '../../../_lib/notify.js'
import { recordDelivery } from '../../../_lib/delivery.js'

const MAX_PDF_SIZE = 8 * 1024 * 1024 // 8MB

async function getCandidate(env, roomId) {
  return env.DB.prepare(
    `SELECT u.id, u.email, u.display_name
     FROM room_participants rp
     JOIN users u ON u.id = rp.user_id
     WHERE rp.room_id = ? AND rp.role_in_room = 'candidate'
     LIMIT 1`
  )
    .bind(roomId)
    .first()
}

async function getStored(env, roomId) {
  return env.DB.prepare(
    `SELECT id, filename, size_bytes, email_status, emailed_at, sha256_hash, created_at
     FROM signed_contracts WHERE room_id = ?`
  )
    .bind(roomId)
    .first()
}

function storedResponse(row) {
  if (!row) return null
  return {
    filename: row.filename,
    sizeBytes: row.size_bytes,
    emailStatus: row.email_status,
    emailedAt: row.emailed_at,
    sha256Hash: row.sha256_hash,
    createdAt: row.created_at,
  }
}

export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const [stored, candidate] = await Promise.all([
    getStored(env, params.roomId),
    getCandidate(env, params.roomId),
  ])

  return jsonResponse({
    stored: storedResponse(stored),
    candidateEmailMasked: candidate ? maskEmail(candidate.email) : null,
    emailConfigured: isEmailConfigured(env),
  })
}

// 서명 완료된 계약서 PDF를 저장하고 지원자에게 이메일로 전송.
export async function onRequestPost({ request, env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('회사 측만 계약서를 저장·전송할 수 있습니다.', 403)
  }

  const room = await env.DB.prepare('SELECT id, status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  if (room.status !== 'signed') {
    return jsonError('양측 서명이 완료된 후에 계약서를 저장할 수 있습니다.', 409)
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('pdf')
  if (!file || typeof file === 'string') return jsonError('계약서 파일이 없습니다.', 400)
  if (file.size > MAX_PDF_SIZE) return jsonError('계약서 파일이 너무 큽니다. (8MB 이하)', 400)

  const buffer = await file.arrayBuffer()
  // 위변조 방지: 저장 시점의 문서 지문(SHA-256). 다운로드한 PDF를 다시 해시해
  // 비교하면 이후 변경되지 않았음을 증명할 수 있다.
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const sha256 = [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
  // 방마다 고정 키를 써서 재저장 때 같은 객체를 덮어쓰고 있었다. 고아 객체는
  // 생기지 않지만, 덮어쓴 직후 DB 쓰기가 실패하면 파일은 새것인데 기록된
  // 지문(sha256)은 옛것이 된다. 그 계약서는 내려받아 해시를 대조할 때마다
  // 영원히 "변조됨"으로 나온다 — 아무도 손대지 않았는데.
  //
  // 저장할 때마다 새 키를 쓴다. 기록이 새 파일을 가리킨 뒤에 옛 파일을 지운다.
  const r2Key = `contracts/${params.roomId}/signed-${Date.now()}.pdf`
  const filename = `근로계약서_${params.roomId.slice(0, 8)}.pdf`

  const existing = await env.DB.prepare('SELECT r2_key FROM signed_contracts WHERE room_id = ?')
    .bind(params.roomId)
    .first()

  await env.DOCUMENTS.put(r2Key, buffer, { httpMetadata: { contentType: 'application/pdf' } })

  const id = genId()
  try {
    await env.DB.prepare(
      `INSERT INTO signed_contracts (id, room_id, r2_key, filename, size_bytes, stored_by_user_id, email_status, sha256_hash)
       VALUES (?, ?, ?, ?, ?, ?, 'not_sent', ?)
       ON CONFLICT(room_id) DO UPDATE SET
         r2_key = excluded.r2_key,
         filename = excluded.filename,
         size_bytes = excluded.size_bytes,
         stored_by_user_id = excluded.stored_by_user_id,
         email_status = 'not_sent',
         email_error = NULL,
         emailed_at = NULL,
         sha256_hash = excluded.sha256_hash,
         updated_at = datetime('now')`
    )
      .bind(id, params.roomId, r2Key, filename, file.size, data.user.id, sha256)
      .run()
  } catch (err) {
    console.error(`Signed contract DB write failed for room ${params.roomId}:`, err)
    // 기록이 가리키는 것은 여전히 옛 파일이다. 방금 올린 것만 치운다.
    await env.DOCUMENTS.delete(r2Key).catch(() => {})
    return jsonError('계약서 저장에 실패했습니다. 잠시 후 다시 시도해주세요.', 500)
  }

  // 기록이 새 파일을 가리킨 뒤에 옛 파일을 지운다. 여기서 실패해도 남는 것은
  // 아무도 가리키지 않는 객체뿐이라, 계약서가 사라지는 일은 없다.
  if (existing?.r2_key && existing.r2_key !== r2Key) {
    await env.DOCUMENTS.delete(existing.r2_key).catch(() => {})
  }

  // 지원자에게 이메일 발송 (설정된 경우에만 시도)
  let emailStatus = 'not_sent'
  let emailError = null
  const candidate = await getCandidate(env, params.roomId)
  if (candidate && isEmailConfigured(env)) {
    try {
      const companyName = data.user.company_name || data.user.display_name
      await sendSignedContractEmail(env, {
        to: candidate.email,
        companyName,
        pdfBase64: arrayBufferToBase64(buffer),
        filename,
      })
      emailStatus = 'sent'
    } catch (err) {
      emailStatus = 'failed'
      emailError = String(err?.message || 'Unknown email error').slice(0, 500)
      console.error(`Signed contract email failed for room ${params.roomId}:`, emailError)
    }
    await env.DB.prepare(
      `UPDATE signed_contracts
       SET email_status = ?, email_error = ?, emailed_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END,
           updated_at = datetime('now')
       WHERE room_id = ?`
    )
      .bind(emailStatus, emailError, emailStatus, params.roomId)
      .run()

    // 교부 이력에도 남긴다. PDF를 다시 저장하면 signed_contracts 의 emailed_at 이
    // 리셋되는데, 교부는 한 번 일어난 사실이므로 별도 표에 보존한다.
    await recordDelivery(env, params.roomId, {
      channel: 'email',
      recipientUserId: candidate.id,
      recipientAddress: candidate.email,
      status: emailStatus === 'sent' ? 'delivered' : 'failed',
      errorMessage: emailError,
    })
  }

  await notifyUser(env, candidate?.id, {
    type: 'contract_stored',
    message: '서명 완료된 근로계약서가 보관되었습니다. 사본을 확인해보세요.',
    link: `/rooms/${params.roomId}/contract`,
  })

  const stored = await getStored(env, params.roomId)
  return jsonResponse(
    {
      ok: true,
      stored: storedResponse(stored),
      emailConfigured: isEmailConfigured(env),
    },
    201
  )
}
