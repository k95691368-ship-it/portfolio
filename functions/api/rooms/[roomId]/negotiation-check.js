import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { blockedWhenClosed } from '../../../_lib/roomLifecycle.js'
import { buildTranscript } from '../../../_lib/transcript.js'
import { reviewNegotiation } from '../../../_lib/claude.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import { termsFromNegotiation, checkNegotiatedTerms } from '../../../_lib/negotiationCheck.js'
import { rowToCamelTerms } from '../../../_lib/contract.js'

// 계약서를 쓰기 전에 대화를 검토한다.
//
// 지금까지 법령 점검은 계약서에 값이 다 채워진 뒤라야 돌 수 있었다. 그런데
// 조건은 계약서에 적히기 훨씬 전에 대화에서 정해지고, 한 번 확정되면 되돌리기
// 어려워진다 — 확정 뒤에 조건을 고치는 것은 이 앱이 막으려는 실질적 취소에
// 해당한다. 그러니 확정되기 전에 봐야 한다.
//
// 두 겹으로 본다.
//
//   협의된 값으로 법정 계산을 미리 돌린다. 순수 함수라 크레딧이 없어도 돌고,
//   같은 값이면 언제나 같은 답이 나온다.
//
//   그리고 대화를 통째로 AI 에 넘긴다. "무엇이 합의되지 않은 채 넘어갔는가",
//   "양측이 서로 다르게 이해하는 지점은 어디인가", "나중에 다툼이 될 모호한
//   표현은 무엇인가" 는 값이 아니라 맥락이라 계산으로는 닿지 않는다.
//
// AI 판정으로 무엇을 막지는 않는다. 재현되지 않는 판정은 근거가 될 수 없다.
// 서명을 실제로 거부하는 것은 여전히 순수 함수의 법정 계산이다. 여기서 AI 가
// 하는 일은 사람이 읽고 판단할 재료를 앞에 놓는 것이다.
const COOLDOWN_SECONDS = 45
const TRANSCRIPT_LIMIT = 300

export async function onRequestPost({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('계약 전 검토는 회사(고용) 측만 실행할 수 있습니다.', 403)
  }

  const room = await env.DB.prepare('SELECT status FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  const closed = blockedWhenClosed(room, 'analyze')
  if (closed) return jsonError(closed, 409)

  const [termsRow, negotiationRows, messageRows, posting] = await Promise.all([
    env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?').bind(params.roomId).first(),
    // 오래된 것부터 잘라 오고 있었다. 여기서 필요한 것은 항목별 '마지막' 값인데
    // 그러면 협의가 길어질수록 옛날 값으로 점검하게 된다 — 점검은 도는데
    // 점검하려던 값이 아닌 것을 점검하는 꼴이다. 최근 것부터 잘라 다시 뒤집는다.
    env.DB.prepare(
      `SELECT * FROM (
         SELECT id, field, label, value, value_display, speaker_role, excerpt, created_at
           FROM negotiation_log WHERE room_id = ? ORDER BY id DESC LIMIT 200
       ) ORDER BY id ASC`
    )
      .bind(params.roomId)
      .all(),
    env.DB.prepare(
      `SELECT * FROM (
         SELECT m.id, m.body, rp.role_in_room, u.display_name
           FROM chat_messages m
           JOIN users u ON u.id = m.sender_user_id
           JOIN room_participants rp ON rp.room_id = m.room_id AND rp.user_id = m.sender_user_id
          WHERE m.room_id = ?
          ORDER BY m.id DESC
          LIMIT ?
       ) ORDER BY id ASC`
    )
      .bind(params.roomId, TRANSCRIPT_LIMIT)
      .all(),
    env.DB.prepare(
      `SELECT p.title, p.wage_type, p.wage_min, p.wage_max, p.work_hours_start,
              p.work_hours_end, p.work_days, p.employment_type, p.location
         FROM applications a JOIN job_postings p ON p.id = a.posting_id
        WHERE a.room_id = ? LIMIT 1`
    )
      .bind(params.roomId)
      .first(),
  ])

  const messages = messageRows.results || []
  if (messages.length === 0) {
    return jsonError('아직 대화가 없어 검토할 것이 없습니다.', 409)
  }

  // 협의된 값으로 미리 돌리는 법정 계산. 크레딧과 무관하게 언제나 나온다.
  const terms = termsFromNegotiation(negotiationRows.results, rowToCamelTerms(termsRow))
  const deterministic = checkNegotiatedTerms(terms, posting)

  // AI 검토는 비싸므로 쿨다운을 건다. 실패하면 소모한 쿨다운을 돌려준다 —
  // 실패한 시도가 다음 시도를 막으면 안 된다.
  const bucket = `negotiation-check:${params.roomId}`
  const ticket = await checkRateLimit(env, bucket, 1, COOLDOWN_SECONDS)
  if (!ticket) {
    return jsonResponse({
      terms,
      deterministic,
      review: null,
      reviewError: `검토는 ${COOLDOWN_SECONDS}초에 한 번만 실행할 수 있습니다. 아래 계산 결과는 지금 값 기준입니다.`,
    })
  }

  const transcript = buildTranscript(messages)
  let review = null
  let reviewError = null
  try {
    review = await reviewNegotiation(env, transcript, {
      posting: posting
        ? {
            title: posting.title,
            wageType: posting.wage_type,
            wageMin: posting.wage_min,
            wageMax: posting.wage_max,
            workHoursStart: posting.work_hours_start,
            workHoursEnd: posting.work_hours_end,
            workDays: posting.work_days,
            employmentType: posting.employment_type,
            location: posting.location,
          }
        : null,
      employeeCount: terms.employeeCount ?? null,
    })
  } catch (err) {
    // AI 가 멈춰도 이 화면은 비지 않는다. 위 계산은 그대로 쓸 수 있다.
    await releaseRateLimit(env, bucket, ticket)
    reviewError = err.message
  }

  return jsonResponse({ terms, deterministic, review, reviewError })
}
