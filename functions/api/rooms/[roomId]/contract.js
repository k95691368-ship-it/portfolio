import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { blockedWhenClosed } from '../../../_lib/roomLifecycle.js'
import { rowToCamelTerms, EDITABLE_FIELDS } from '../../../_lib/contract.js'
import {
  normalizeWageItems,
  parseWageItemsJson,
  alignWageItemsWithBase,
  baseAmountFromItems,
} from '../../../_lib/wageItems.js'
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

// 한 사람이 받을 수 있는 월 임금의 상한이라기보다, 숫자가 아닌 것과 실수로
// 붙은 0 을 걸러 내기 위한 선이다.
const MAX_WAGE = 1_000_000_000
const MAX_CUSTOM_TERMS = 20
const MAX_CUSTOM_LABEL = 100
const MAX_CUSTOM_VALUE = 1000

// '그 밖의 사항'만 개수·길이·타입 상한이 없었다. 배열이 아닌 값도 그대로
// JSON.stringify 되어 저장되고, 읽는 쪽은 배열로 다루므로 계약서 화면이
// 양쪽 모두에게 죽는다 — 회사도 근로자도 계약서를 열 수 없게 된다.
function validateCustomTerms(raw) {
  if (raw === null || raw === undefined) return null
  if (!Array.isArray(raw)) return '그 밖의 사항은 목록 형태여야 합니다.'
  if (raw.length > MAX_CUSTOM_TERMS) {
    return `그 밖의 사항은 ${MAX_CUSTOM_TERMS}개까지 입력할 수 있습니다.`
  }
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return '그 밖의 사항의 각 항목은 항목명과 내용을 가져야 합니다.'
    }
    if (typeof entry.label !== 'string' || typeof entry.value !== 'string') {
      return '그 밖의 사항의 항목명과 내용은 글로 적어주세요.'
    }
    if (entry.label.length > MAX_CUSTOM_LABEL || entry.value.length > MAX_CUSTOM_VALUE) {
      return `그 밖의 사항의 항목명은 ${MAX_CUSTOM_LABEL}자, 내용은 ${MAX_CUSTOM_VALUE}자까지 입력할 수 있습니다.`
    }
  }
  return null
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
  const editBlock = blockedWhenClosed(room, 'edit_terms')
  if (editBlock) return jsonError(editBlock, 409)

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('잘못된 요청입니다.', 400)
  }

  const existing = await env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()

  // 임금은 비어 있는 것만 막고 0원·음수는 그대로 받고 있었다. 0원은 필수 항목
  // 검사에서 "값이 있다"로 통과하는데, 최저임금 계산에서는 wage > 0 조건에
  // 걸려 검사 자체가 생략된다. 채워졌으니 서명은 열리고, 검사는 꺼진다.
  if (Object.prototype.hasOwnProperty.call(body, 'wageBaseAmount')) {
    const raw = body.wageBaseAmount
    if (raw !== '' && raw !== null && raw !== undefined) {
      const amount = Number(raw)
      if (!Number.isFinite(amount) || amount <= 0) {
        return jsonError('기본급은 0보다 큰 금액이어야 합니다.', 400)
      }
      if (amount > MAX_WAGE) {
        return jsonError('기본급이 입력할 수 있는 범위를 벗어났습니다.', 400)
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'customTerms')) {
    const bad = validateCustomTerms(body.customTerms)
    if (bad) return jsonError(bad, 400)
  }

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
  if (Object.prototype.hasOwnProperty.call(body, 'wageItems')) {
    const normalized = normalizeWageItems(body.wageItems)
    if (!normalized.ok) return jsonError(normalized.error, 400)
    const newJson = normalized.items.length > 0 ? JSON.stringify(normalized.items) : null
    columns.push('wage_items_json')
    values.push(newJson)
    const oldJson = existing?.wage_items_json ?? null
    if ((oldJson ?? '') !== (newJson ?? '')) {
      changes.push({ field: 'wageItems', from: oldJson, to: newJson })
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

  // 기본급은 wage_base_amount 컬럼과 wageItems 의 base 항목, 두 곳에 있다.
  // 한쪽만 고치면 계약서 화면과 최저임금 계산이 서로 다른 금액을 본다.
  const baseIdx = columns.indexOf('wage_base_amount')
  const itemsIdx = columns.indexOf('wage_items_json')
  const itemsNow =
    itemsIdx >= 0 ? parseWageItemsJson(values[itemsIdx]) : parseWageItemsJson(existing?.wage_items_json)

  if (baseIdx >= 0 && itemsNow.length > 0) {
    const alignedJson = JSON.stringify(alignWageItemsWithBase(itemsNow, values[baseIdx]))
    if (itemsIdx >= 0) {
      values[itemsIdx] = alignedJson
      const idx = changes.findIndex((c) => c.field === 'wageItems')
      if (idx >= 0) changes[idx].to = alignedJson
    } else if ((existing?.wage_items_json ?? '') !== alignedJson) {
      columns.push('wage_items_json')
      values.push(alignedJson)
      changes.push({ field: 'wageItems', from: existing?.wage_items_json ?? null, to: alignedJson })
    }
  } else if (itemsIdx >= 0 && baseIdx < 0) {
    const derived = baseAmountFromItems(itemsNow)
    if (derived !== null && String(existing?.wage_base_amount ?? '') !== String(derived)) {
      columns.push('wage_base_amount')
      values.push(derived)
      changes.push({ field: 'wageBaseAmount', from: existing?.wage_base_amount ?? null, to: derived })
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
