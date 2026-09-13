import { jsonResponse, jsonError } from '../../../../../_lib/http.js'
import { checkRateLimit } from '../../../../../_lib/rateLimit.js'
import { activeSignalMembers, validateSignal } from '../../../../../_lib/interviewSignaling.js'

export async function onRequestPost({ env, request, data, params }) {
  if (!data.user || data.user.is_admin) return jsonError('참가자 인증이 필요합니다.', 403)
  const raw = await request.text()
  if (raw.length > 70000) return jsonError('신호가 너무 큽니다.', 413)
  let body
  try { body = JSON.parse(raw) } catch { return jsonError('잘못된 요청입니다.', 400) }
  if (!body || typeof body !== 'object') return jsonError('잘못된 요청입니다.', 400)
  if (!await checkRateLimit(env, `signal:${data.user.id}`, 600, 60)) return jsonError('신호 요청 한도를 초과했습니다.', 429)
  const members = await activeSignalMembers(env.DB, params.roomId, params.sessionId)
  const self = members.find((m) => m.user_id === data.user.id && m.provider_participant_id === body.participantId)
  if (!self) return jsonError('입장 권한이 만료되었거나 녹화 동의가 철회되었습니다.', 403)
  const invalid = validateSignal(body, self, members)
  if (invalid) return jsonError(invalid, 403)
  if (body.action === 'leave') {
    await env.DB.prepare(`UPDATE interview_session_members SET signaling_seen_at = NULL,
      left_at = datetime('now') WHERE session_id = ? AND user_id = ? AND provider_participant_id = ?`)
      .bind(params.sessionId, data.user.id, self.provider_participant_id).run()
    return jsonResponse({ ok: true })
  }
  await env.DB.prepare(`UPDATE interview_session_members SET signaling_seen_at = datetime('now')
    WHERE session_id = ? AND user_id = ? AND provider_participant_id = ?`)
    .bind(params.sessionId, data.user.id, self.provider_participant_id).run()
  if (body.action === 'send') {
    if (body.event === 'huddle') {
      await env.DB.prepare('UPDATE interview_sessions SET huddle_active = ? WHERE id = ?')
        .bind(body.payload.active ? 1 : 0, params.sessionId).run()
    } else {
      const payload = { from: self.provider_participant_id, to: body.payload.to,
        ...(body.payload.description ? { description: body.payload.description } : { candidate: body.payload.candidate }) }
      await env.DB.prepare(`INSERT INTO interview_signals (session_id, sender_id, recipient_id, payload)
        VALUES (?, ?, ?, ?)`).bind(params.sessionId, self.provider_participant_id, payload.to, JSON.stringify(payload)).run()
    }
    return jsonResponse({ ok: true })
  }
  // Read a recent overlap rather than a sequence cursor: concurrent transaction
  // commits can be observed out of sequence. The browser deduplicates IDs.
  const { results: messages } = await env.DB.prepare(`SELECT id, sender_id, payload FROM interview_signals
    WHERE session_id = ? AND recipient_id = ? AND created_at > datetime('now', '-30 seconds') ORDER BY id LIMIT 600`)
    .bind(params.sessionId, self.provider_participant_id).all()
  const session = await env.DB.prepare('SELECT huddle_active FROM interview_sessions WHERE id = ?').bind(params.sessionId).first()
  const alive = members.filter((m) => m.user_id === self.user_id || Date.parse(String(m.signaling_seen_at || '').replace(' ', 'T').replace(/Z?$/, 'Z')) > Date.now() - 10000)
  return jsonResponse({
    members: alive.map((m) => ({ participantId: m.provider_participant_id, customParticipantId: m.custom_participant_id, role: m.role, displayName: m.display_name })),
    messages: (messages || []).filter((m) => alive.some((p) => p.provider_participant_id === m.sender_id)).map((m) => ({ id: String(m.id), payload: JSON.parse(m.payload) })),
    huddleActive: session?.huddle_active === 1,
  })
}
