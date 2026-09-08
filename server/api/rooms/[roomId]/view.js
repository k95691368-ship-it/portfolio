import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { describeOfferStatus } from '../../../_lib/jobOffer.js'
import { describeNegotiation } from '../../../_lib/termsNegotiation.js'
import { getRoomAccess, loadCompanyMessages } from '../../../_lib/rooms.js'
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

export async function onRequestGet({ env, data, params, waitUntil }) {
  // 코드로 들어온 사람은 계정이 없다. 로그인을 요구하면 서류합격 안내를 받고
  // 코드로 들어온 지원자가 그대로 막힌다.
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const roomId = params.roomId
  const room = await env.DB.prepare('SELECT * FROM interview_rooms WHERE id = ?').bind(roomId).first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)

  const access = await getRoomAccess(env, roomId, data.user)
  if (!access) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const isCompany = access.role_in_room === 'company'

  // 이 사람이 방을 열어 본 시각을 남긴다.
  //
  // 눈앞에서 대화하는 사람에게 "새 메시지가 도착했습니다" 메일을 보내는 것은
  // 알림이 아니라 방해다. 방금까지 보고 있었는지를 이 값으로 안다.
  //
  // 로그인 시각으로는 알 수 없다 -- 로그인은 30일 유지되므로 한 달 전에
  // 들어온 사람도 '로그인 중'이다.
  //
  // 응답을 붙잡지 않는다. 실패해도 이번 조회와는 상관없고, 최악이라도 메일이
  // 한 통 더 갈 뿐이다.
  const seen = env.DB.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?")
    .bind(data.user.id)
    .run()
    .catch(() => {})
  if (waitUntil) waitUntil(seen)

  const [participantRows, termsRow, negotiationRows, messageRows, offerMessages, finalOffer] =
    await Promise.all([
    env.DB.prepare(
      `SELECT u.id, u.display_name, u.company_name, u.email, rp.role_in_room
         FROM room_participants rp
         JOIN users u ON u.id = rp.user_id
        WHERE rp.room_id = ?`
    )
      .bind(roomId)
      .all(),
    env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?').bind(roomId).first(),
    // 처우 협의 이력. 계약서에 적히기 전에 대화에서 정해진 것들이다.
    //
    // 오래된 것부터 잘라 오면 협의가 길어질수록 화면의 '지금까지 합의된 값'이
    // 옛날 값에서 멈춘다. 최근 것부터 잘라 다시 뒤집는다.
    env.DB.prepare(
      `SELECT * FROM (
         SELECT id, message_id, speaker_role, field, label, value, value_display,
                previous_value, excerpt, created_at
           FROM negotiation_log WHERE room_id = ? ORDER BY id DESC LIMIT 200
       ) ORDER BY id ASC`
    )
      .bind(roomId)
      .all(),
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
    // 판정은 화면과 다른 조회를 쓴다. 화면에 뿌리는 목록은 최근 것부터 잘라
    // 오는 창이라, 대화가 길어지면 확정을 성립시킨 문장이 창 밖으로 밀려나며
    // 경고가 조용히 꺼진다.
    loadCompanyMessages(env, roomId),
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
      // 입장 코드는 회사에게만 내려간다.
      //
      // 코드가 로그인 수단이 된 뒤로 이것은 비밀번호와 같다. 지금까지는 방을
      // 여는 누구에게나 함께 보내고 화면에서만 가리고 있었다 — 개발자 도구를
      // 열 필요도 없이 응답에 그대로 들어 있었다.
      inviteCode: isCompany ? room.invite_code : null,
      status: room.status,
      closeReason: room.close_reason ?? null,
      // 보관은 status 를 덮지 않는다. 종료였는지 체결이었는지가 지워지면
      // 채용내정을 다투는 자리에서 그 구분이 사라진다.
      archivedAt: room.archived_at ?? null,
      archivedByName: room.archived_by_name ?? null,
      myRole: access.role_in_room,
      // 이 방에서 나는 누구인가.
      //
      // 화면은 지금까지 전역 로그인 정보(user.id)로 내 말풍선을 골랐다. 코드로
      // 들어온 사람은 계정 로그인이 없어 그 값이 비어 있고, 회사 계정이 함께
      // 있는 브라우저에서는 아예 다른 사람의 id 가 들어 있다. 신원은 방마다
      // 갈리므로 방이 직접 알려 준다.
      viewer: {
        id: data.user.id,
        displayName: data.user.display_name,
        role: access.role_in_room,
        authMethod: data.user.session_auth_method ?? 'password',
      },
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
    // 처우 협의 이력 — 계약서에 적히기 전에 대화에서 정해진 것들.
    // 회사 쪽에만 내려준다. 지원자 화면에 "당신이 이 값을 제시했다"를 나열하는
    // 것은 이 도구의 목적이 아니다.
    negotiation: isCompany ? describeNegotiation(negotiationRows.results) : null,
    // 채용내정이 성립했는가, 그리고 지금 끝내면 무슨 일이 벌어지는가.
    //
    // 확정은 회사만 할 수 있어서, 지원자가 "언제 출근하면 되나요"라고 묻는
    // 것을 확정으로 읽으면 안 된다. 그래서 회사 발화만 처음부터 읽는다.
    offer: describeOfferStatus({
      // 원본 행을 그대로 넘긴다. rowToCamelTerms 는 hire_confirmed 를 담지
      // 않아서, 카멜만 넘기면 확정 여부가 판정에 도달하지 않는다.
      terms: termsRow,
      messages: offerMessages,
    }),
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
