import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomAccess } from '../../../_lib/rooms.js'

// SQLite "YYYY-MM-DD HH:MM:SS"와 ISO "....T...Z"가 섞여 있어 정렬용으로 통일한다.
function normalizeTime(t) {
  if (!t) return ''
  return String(t).replace('T', ' ').replace('Z', '').slice(0, 19)
}

// 감사추적: 면접방 생성부터 서명·보관·발송까지의 전 과정을 시간순으로 반환.
// 참여자 양측 + 관리자(열람)가 볼 수 있으며, 계약서 PDF 출력에도 포함된다.
export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const access = await getRoomAccess(env, params.roomId, data.user)
  if (!access) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const [room, participants, terms, history, signatures, signedContract, finalOffer] =
    await Promise.all([
      env.DB.prepare('SELECT title, created_at FROM interview_rooms WHERE id = ?')
        .bind(params.roomId)
        .first(),
      env.DB.prepare(
        `SELECT u.display_name, rp.role_in_room, rp.joined_at
         FROM room_participants rp JOIN users u ON u.id = rp.user_id
         WHERE rp.room_id = ?`
      )
        .bind(params.roomId)
        .all(),
      env.DB.prepare(
        'SELECT hire_confirmed_at, last_analyzed_at FROM contract_terms WHERE room_id = ?'
      )
        .bind(params.roomId)
        .first(),
      env.DB.prepare(
        `SELECT h.created_at, u.display_name, h.changes
         FROM contract_edit_history h JOIN users u ON u.id = h.editor_user_id
         WHERE h.room_id = ? ORDER BY h.id ASC LIMIT 100`
      )
        .bind(params.roomId)
        .all(),
      env.DB.prepare(
        `SELECT s.signer_role, s.signed_at, u.display_name
         FROM signatures s JOIN users u ON u.id = s.signer_user_id
         WHERE s.room_id = ?`
      )
        .bind(params.roomId)
        .all(),
      env.DB.prepare(
        'SELECT created_at, emailed_at, sha256_hash, filename FROM signed_contracts WHERE room_id = ?'
      )
        .bind(params.roomId)
        .first(),
      env.DB.prepare('SELECT sent_at, status FROM final_offer_emails WHERE room_id = ?')
        .bind(params.roomId)
        .first(),
    ])

  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)

  const events = []
  events.push({ at: room.created_at, event: '면접방 생성', detail: room.title })

  for (const p of participants.results) {
    events.push({
      at: p.joined_at,
      event: p.role_in_room === 'company' ? '회사 참여' : '지원자 참여',
      detail: p.display_name,
    })
  }
  if (terms?.last_analyzed_at) {
    events.push({ at: terms.last_analyzed_at, event: 'AI 조건 분석 (최근)', detail: null })
  }
  if (terms?.hire_confirmed_at) {
    events.push({ at: terms.hire_confirmed_at, event: '채용 확정', detail: null })
  }
  for (const h of history.results) {
    let count = 0
    try {
      count = JSON.parse(h.changes).length
    } catch {
      count = 0
    }
    events.push({
      at: h.created_at,
      event: '계약 조건 수정',
      detail: `${h.display_name} · ${count}개 항목`,
    })
  }
  for (const s of signatures.results) {
    events.push({
      at: s.signed_at,
      event: s.signer_role === 'company' ? '회사 서명' : '지원자 서명',
      detail: s.display_name,
    })
  }
  if (finalOffer?.sent_at) {
    events.push({ at: finalOffer.sent_at, event: '최종합격 이메일 발송', detail: null })
  }
  if (signedContract) {
    events.push({
      at: signedContract.created_at,
      event: '서명 계약서 보관',
      detail: signedContract.filename,
    })
    if (signedContract.emailed_at) {
      events.push({ at: signedContract.emailed_at, event: '계약서 사본 이메일 발송', detail: null })
    }
  }

  events.sort((a, b) => normalizeTime(a.at).localeCompare(normalizeTime(b.at)))

  return jsonResponse({
    roomTitle: room.title,
    documentHash: signedContract?.sha256_hash ?? null,
    events: events.map((e) => ({ ...e, at: normalizeTime(e.at) })),
  })
}
