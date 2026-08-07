import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomAccess } from '../../../_lib/rooms.js'
import { rowToCamelTerms } from '../../../_lib/contract.js'
import { mapDocumentRow } from '../../../_lib/documents.js'
import { maskEmail, isEmailConfigured } from '../../../_lib/email.js'

// 면접방 화면이 필요한 모든 정보를 한 번에 돌려준다.
//
// 계약서 화면에서 했던 것과 같은 작업이다. 이 화면은 방 정보·계약 조건·대화·
// 첨부 서류·면접 요약·초대 이메일·최종합격 이메일을 각각 따로 요청해서, 회사
// 계정으로 들어가면 요청이 일곱 번 나갔다. 요청마다 세션 인증과 참여자 확인을
// 다시 하고, 근로자 정보를 세 번 따로 읽었다.
//
// 대화는 이후에도 계속 확인해야 하므로 첫 묶음만 여기서 주고, 그다음부터는
// 기존의 가벼운 증분 조회를 그대로 쓴다.
const MESSAGE_LIMIT = 200

export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const roomId = params.roomId
  const room = await env.DB.prepare('SELECT * FROM interview_rooms WHERE id = ?').bind(roomId).first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)

  const access = await getRoomAccess(env, roomId, data.user)
  if (!access) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const isCompany = access.role_in_room === 'company'

  const [participantRows, termsRow, messageRows, finalOffer] = await Promise.all([
    env.DB.prepare(
      `SELECT u.id, u.display_name, u.company_name, u.email, rp.role_in_room
         FROM room_participants rp
         JOIN users u ON u.id = rp.user_id
        WHERE rp.room_id = ?`
    )
      .bind(roomId)
      .all(),
    env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?').bind(roomId).first(),
    env.DB.prepare(
      // 오래된 것부터 자르면 방을 열었을 때 대화 맨 앞이 뜬다. 메시지가 쌓인
      // 방에서는 최근 대화가 폴링을 여러 번 돈 뒤에야 나타나고, 그 사이 양측은
      // 서로의 최근 발언을 못 본 채 협상한다. 최근 것부터 잘라 다시 뒤집는다.
      `SELECT * FROM (
         SELECT m.id, m.sender_user_id, m.body, m.created_at, u.display_name AS sender_name
           FROM chat_messages m
           JOIN users u ON u.id = m.sender_user_id
          WHERE m.room_id = ?
          ORDER BY m.id DESC
          LIMIT ?
       ) ORDER BY id ASC`
    )
      .bind(roomId, MESSAGE_LIMIT)
      .all(),
    isCompany
      ? env.DB.prepare(
          `SELECT status, recipient_email, subject, attempt_count, sent_at, created_at, updated_at
             FROM final_offer_emails WHERE room_id = ?`
        )
          .bind(roomId)
          .first()
      : Promise.resolve(null),
  ])

  const participants = participantRows.results
  // 근로자를 한 번만 찾아 서류·초대 이메일·최종합격 이메일이 함께 쓴다.
  const candidate = participants.find((p) => p.role_in_room === 'candidate')

  const [documentRows, summaryRow] = await Promise.all([
    candidate
      ? env.DB.prepare(
          'SELECT id, doc_type, filename, size_bytes, uploaded_at FROM documents WHERE user_id = ?'
        )
          .bind(candidate.id)
          .all()
      : Promise.resolve({ results: [] }),
    isCompany
      ? env.DB.prepare(
          `SELECT s.summary_json, s.message_count, s.created_at, u.display_name AS author
             FROM interview_summaries s
             JOIN users u ON u.id = s.created_by_user_id
            WHERE s.room_id = ?`
        )
          .bind(roomId)
          .first()
      : Promise.resolve(null),
  ])

  let interviewSummary = null
  if (summaryRow) {
    try {
      interviewSummary = {
        summary: JSON.parse(summaryRow.summary_json),
        messageCount: summaryRow.message_count,
        createdAt: summaryRow.created_at,
        author: summaryRow.author,
      }
    } catch {
      interviewSummary = null
    }
  }

  const candidateBrief = candidate
    ? { displayName: candidate.display_name, emailMasked: maskEmail(candidate.email) }
    : null

  return jsonResponse({
    room: {
      id: room.id,
      title: room.title,
      inviteCode: room.invite_code,
      status: room.status,
      closeReason: room.close_reason ?? null,
      myRole: access.role_in_room,
      participants: participants.map((p) => ({
        id: p.id,
        displayName: p.display_name,
        companyName: p.company_name,
        role: p.role_in_room,
      })),
    },
    contract: termsRow
      ? {
          terms: rowToCamelTerms(termsRow),
          hireConfirmed: !!termsRow.hire_confirmed,
          hireConfirmedAt: termsRow.hire_confirmed_at,
          confirmationExcerpt: termsRow.hire_confirmation_excerpt,
          updatedAt: termsRow.updated_at,
        }
      : { terms: null, hireConfirmed: false },
    messages: messageRows.results.map((m) => ({
      id: m.id,
      senderId: m.sender_user_id,
      senderName: m.sender_name,
      body: m.body,
      createdAt: m.created_at,
    })),
    documents: documentRows.results.map(mapDocumentRow),
    // 아래 셋은 회사 측 화면에만 쓰인다.
    interviewSummary: isCompany ? interviewSummary : null,
    inviteEmail: isCompany ? { candidate: candidateBrief, emailConfigured: isEmailConfigured(env) } : null,
    finalOfferEmail: isCompany
      ? {
          candidate: candidateBrief,
          delivery: finalOffer
            ? {
                status: finalOffer.status,
                recipientEmailMasked: maskEmail(finalOffer.recipient_email),
                subject: finalOffer.subject,
                attemptCount: finalOffer.attempt_count,
                sentAt: finalOffer.sent_at,
                createdAt: finalOffer.created_at,
                updatedAt: finalOffer.updated_at,
              }
            : null,
          emailConfigured: isEmailConfigured(env),
        }
      : null,
  })
}
