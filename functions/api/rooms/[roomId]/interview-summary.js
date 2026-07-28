import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { summarizeInterview } from '../../../_lib/claude.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'

// 면접 대화의 회사 보관용 요약 기록.
//
// 계약 조건 추출과 달리, 여기서는 "무슨 이야기가 오갔고 무엇이 아직 정해지지
// 않았는가"를 남긴다. 지원자에 대한 평가가 아니라 기록이므로, 만든 사람과
// 만든 시점, 그때까지의 대화 수를 함께 남겨 나중에 무엇을 근거로 쓴 요약인지
// 알 수 있게 한다.
const TRANSCRIPT_LIMIT = 300
const MIN_MESSAGES = 4

// 회사 측 기록이므로 회사 참여자만 볼 수 있다.
async function requireCompany(env, roomId, user) {
  const participant = await getRoomParticipant(env, roomId, user.id)
  if (!participant) return { error: jsonError('이 면접방에 참여하지 않았습니다.', 403) }
  if (participant.role_in_room !== 'company') {
    return { error: jsonError('면접 요약 기록은 회사(고용) 측만 볼 수 있습니다.', 403) }
  }
  return { participant }
}

export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const { error } = await requireCompany(env, params.roomId, data.user)
  if (error) return error

  const row = await env.DB.prepare(
    `SELECT s.summary_json, s.message_count, s.created_at, u.display_name AS author
       FROM interview_summaries s
       JOIN users u ON u.id = s.created_by_user_id
      WHERE s.room_id = ?`
  )
    .bind(params.roomId)
    .first()

  if (!row) return jsonResponse({ summary: null })

  let summary = null
  try {
    summary = JSON.parse(row.summary_json)
  } catch {
    return jsonError('저장된 요약을 읽을 수 없습니다. 다시 작성해주세요.', 500)
  }

  return jsonResponse({
    summary,
    messageCount: row.message_count,
    createdAt: row.created_at,
    author: row.author,
  })
}

export async function onRequestPost({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const { error } = await requireCompany(env, params.roomId, data.user)
  if (error) return error

  if (!data.user.is_admin && !data.user.is_recruiter) {
    return jsonError('면접 요약은 채용자 또는 관리자 권한이 있는 계정만 작성할 수 있습니다.', 403)
  }

  const bucket = `interview-summary:${params.roomId}`
  const allowed = await checkRateLimit(env, bucket, 5, 300)
  if (!allowed) return jsonError('요약 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)

  const { results: messages } = await env.DB.prepare(
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
    .all()

  if (messages.length < MIN_MESSAGES) {
    await releaseRateLimit(env, bucket)
    return jsonError(
      `요약할 대화가 아직 충분하지 않습니다. (현재 ${messages.length}건, 최소 ${MIN_MESSAGES}건 필요)`,
      400
    )
  }

  const transcript = messages
    .map((m) => `${m.role_in_room === 'company' ? '회사' : '지원자'}(${m.display_name}): ${m.body}`)
    .join('\n')

  let summary
  try {
    summary = await summarizeInterview(env, transcript)
  } catch (err) {
    // 실패한 시도는 한도에서 뺀다 (다시 시도할 수 있어야 한다).
    await releaseRateLimit(env, bucket)
    return jsonError(err.message, 502)
  }

  const clean = {
    overview: String(summary.overview || '').slice(0, 3000),
    discussedConditions: (Array.isArray(summary.discussed_conditions) ? summary.discussed_conditions : [])
      .slice(0, 20)
      .map((c) => ({
        topic: String(c?.topic || '').slice(0, 100),
        detail: String(c?.detail || '').slice(0, 500),
        settled: c?.settled === true,
      })),
    candidateStatements: (Array.isArray(summary.candidate_statements) ? summary.candidate_statements : [])
      .slice(0, 20)
      .map((s) => String(s).slice(0, 500)),
    openQuestions: (Array.isArray(summary.open_questions) ? summary.open_questions : [])
      .slice(0, 20)
      .map((s) => String(s).slice(0, 500)),
    nextSteps: (Array.isArray(summary.next_steps) ? summary.next_steps : [])
      .slice(0, 20)
      .map((s) => String(s).slice(0, 500)),
  }

  await env.DB.prepare(
    `INSERT INTO interview_summaries
       (room_id, summary_json, message_count, last_message_id, created_by_user_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET
       summary_json = excluded.summary_json,
       message_count = excluded.message_count,
       last_message_id = excluded.last_message_id,
       created_by_user_id = excluded.created_by_user_id,
       created_at = datetime('now')`
  )
    .bind(
      params.roomId,
      JSON.stringify(clean),
      messages.length,
      messages[messages.length - 1].id,
      data.user.id
    )
    .run()

  return jsonResponse({ summary: clean, messageCount: messages.length }, 201)
}
