import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { rowToCamelTerms, EDITABLE_FIELDS } from '../../../_lib/contract.js'
import { getRoomParticipant, getRoomAccess } from '../../../_lib/rooms.js'
import { revokeSignaturesOnChange } from '../../../_lib/signatureLock.js'

export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomAccess(env, params.roomId, data.user)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const row = await env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()

  if (!row) return jsonResponse({ terms: null, hireConfirmed: false })

  return jsonResponse({
    terms: rowToCamelTerms(row),
    hireConfirmed: !!row.hire_confirmed,
    hireConfirmedAt: row.hire_confirmed_at,
    confirmationExcerpt: row.hire_confirmation_excerpt,
    updatedAt: row.updated_at,
  })
}

export async function onRequestPatch({ env, data, params, request }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('계약서는 회사(고용) 측만 수정할 수 있습니다.', 403)
  }

  const room = await env.DB.prepare('SELECT status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  if (room.status === 'signed') return jsonError('이미 서명이 완료된 계약서는 수정할 수 없습니다.', 409)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('잘못된 요청입니다.', 400)
  }

  const existing = await env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()

  const columns = []
  const values = []
  const changes = []
  for (const [camelKey, column] of Object.entries(EDITABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(body, camelKey)) {
      const newVal = body[camelKey] === '' ? null : body[camelKey]
      columns.push(column)
      values.push(newVal)
      const oldVal = existing ? (existing[column] ?? null) : null
      if (String(oldVal ?? '') !== String(newVal ?? '')) {
        changes.push({ field: camelKey, from: oldVal, to: newVal })
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'socialInsurance')) {
    const newJson = body.socialInsurance ? JSON.stringify(body.socialInsurance) : null
    columns.push('social_insurance_json')
    values.push(newJson)
    const oldJson = existing?.social_insurance_json ?? null
    if ((oldJson ?? '') !== (newJson ?? '')) {
      changes.push({ field: 'socialInsurance', from: oldJson, to: newJson })
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'customTerms')) {
    const newJson =
      body.customTerms && body.customTerms.length > 0 ? JSON.stringify(body.customTerms) : null
    columns.push('custom_terms_json')
    values.push(newJson)
    const oldJson = existing?.custom_terms_json ?? null
    if ((oldJson ?? '') !== (newJson ?? '')) {
      changes.push({ field: 'customTerms', from: oldJson, to: newJson })
    }
  }

  if (columns.length === 0) return jsonError('수정할 항목이 없습니다.', 400)

  if (existing) {
    const setSql = columns.map((c) => `${c} = ?`).join(', ') + ", updated_at = datetime('now')"
    await env.DB.prepare(`UPDATE contract_terms SET ${setSql} WHERE room_id = ?`)
      .bind(...values, params.roomId)
      .run()
  } else {
    const insertCols = ['room_id', ...columns]
    const placeholders = insertCols.map(() => '?').join(', ')
    await env.DB.prepare(`INSERT INTO contract_terms (${insertCols.join(', ')}) VALUES (${placeholders})`)
      .bind(params.roomId, ...values)
      .run()
  }

  if (changes.length > 0) {
    await env.DB.prepare(
      'INSERT INTO contract_edit_history (room_id, editor_user_id, changes) VALUES (?, ?, ?)'
    )
      .bind(params.roomId, data.user.id, JSON.stringify(changes))
      .run()
  }

  // 상대방이 이미 서명해 둔 상태에서 내용을 바꾸면 그 서명은 더 이상 이 내용에
  // 대한 동의가 아니다. 무효화하고 다시 받는다.
  const revocation =
    changes.length > 0
      ? await revokeSignaturesOnChange(env, params.roomId, {
          actorUserId: data.user.id,
          reason: `계약 조건 변경 (${changes.map((c) => c.field).join(', ')})`,
        })
      : { revoked: 0 }

  const row = await env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()

  return jsonResponse({
    terms: rowToCamelTerms(row),
    hireConfirmed: !!row.hire_confirmed,
    hireConfirmedAt: row.hire_confirmed_at,
    confirmationExcerpt: row.hire_confirmation_excerpt,
    updatedAt: row.updated_at,
    revokedSignatures: revocation.revoked,
  })
}
