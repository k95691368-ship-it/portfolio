import { jsonError, jsonResponse } from '../_lib/http.js'
import {
  CONSENT_NOTICE_HASH,
  CONSENT_NOTICE_VERSION,
  mapProviderSessionStatus,
  normalizeProviderRecording,
} from '../_lib/interviews.js'
import { adoptDirectRecordingFromR2 } from '../_lib/interviewRecordings.js'
import { deleteMeeting, isRealtimeKitAlreadyEnded } from '../_lib/realtimekit.js'

const MAX_WEBHOOK_BYTES = 256 * 1024
const PUBLIC_KEY_URL = 'https://api.realtime.cloudflare.com/.well-known/webhooks.json'

function decodeBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

function cleanPublicKey(pem) {
  return String(pem || '')
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '')
}

export async function verifyWebhookSignature(publicKeyPem, signature, rawBody) {
  if (!publicKeyPem || !signature) return false
  const keyBytes = decodeBase64(cleanPublicKey(publicKeyPem))
  const signatureBytes = decodeBase64(signature)
  const key = await crypto.subtle.importKey(
    'spki',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signatureBytes, rawBody)
}

export async function loadWebhookPublicKey(env) {
  if (env?.REALTIMEKIT_WEBHOOK_PUBLIC_KEY) return env.REALTIMEKIT_WEBHOOK_PUBLIC_KEY
  const response = await fetch(PUBLIC_KEY_URL, {
    headers: { Accept: 'application/json' },
  }).catch(() => null)
  if (!response?.ok) throw new Error('public_key_fetch_failed')
  const payload = await response.json().catch(() => null)
  const key = payload?.data?.publicKey
  if (payload?.success !== true || typeof key !== 'string' || !key.includes('PUBLIC KEY')) {
    throw new Error('public_key_response_invalid')
  }
  return key
}

export function parseRealtimeKitEvent(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.event !== 'string') return null
  const meeting = payload.meeting && typeof payload.meeting === 'object' ? payload.meeting : {}
  const participant =
    payload.participant && typeof payload.participant === 'object' ? payload.participant : {}
  const recording = normalizeProviderRecording(payload.recording)
  const providerMeetingId =
    meeting.id || payload.meetingId || payload.meeting_id || recording?.meetingId || null
  const providerSessionId =
    meeting.sessionId || meeting.session_id || payload.sessionId || payload.session_id || recording?.providerSessionId || null

  return {
    type: payload.event.slice(0, 100),
    providerMeetingId,
    providerSessionId,
    meetingStatus: mapProviderSessionStatus(meeting.status),
    startedAt: meeting.startedAt || meeting.started_at || null,
    endedAt: meeting.endedAt || meeting.ended_at || null,
    reason: typeof payload.reason === 'string' ? payload.reason.slice(0, 100) : null,
    participant: {
      customParticipantId:
        participant.customParticipantId ||
        participant.custom_participant_id ||
        participant.clientSpecificId ||
        null,
      peerId: participant.peerId || participant.peer_id || null,
      joinedAt: participant.joinedAt || participant.joined_at || null,
      leftAt: participant.leftAt || participant.left_at || null,
    },
    recording,
  }
}

async function findSession(env, providerMeetingId) {
  if (!providerMeetingId) return null
  return env.DB.prepare(
    'SELECT id, room_id, provider_meeting_id FROM interview_sessions WHERE provider_meeting_id = ?'
  )
    .bind(providerMeetingId)
    .first()
}

function safeEventDetails(parsed, localRecordingId = null) {
  if (parsed.type === 'recording.statusUpdate') {
    return {
      recordingId: localRecordingId,
      providerRecordingId: parsed.recording?.providerRecordingId ?? null,
      status: parsed.recording?.status ?? null,
    }
  }
  if (parsed.type === 'meeting.participantJoined' || parsed.type === 'meeting.participantLeft') {
    return {
      customParticipantId: parsed.participant.customParticipantId,
      peerId: parsed.participant.peerId,
    }
  }
  return { reason: parsed.reason, providerSessionId: parsed.providerSessionId }
}

async function updateRecording(env, parsed, session) {
  const provider = parsed.recording
  if (!provider?.providerRecordingId || !session) return null

  let row = await env.DB.prepare(
    'SELECT * FROM interview_recordings WHERE provider_recording_id = ?'
  )
    .bind(provider.providerRecordingId)
    .first()
  if (!row) {
    const id = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT OR IGNORE INTO interview_recordings
         (id, session_id, provider_recording_id, provider_session_id, status, storage_status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        session.id,
        provider.providerRecordingId,
        provider.providerSessionId,
        provider.status === 'available' ? 'processing' : provider.status || 'starting',
        provider.status === 'available' ? 'copying' : 'pending'
      )
      .run()
    row = await env.DB.prepare(
      'SELECT * FROM interview_recordings WHERE provider_recording_id = ?'
    )
      .bind(provider.providerRecordingId)
      .first()
  }
  if (!row) return null

  const lowerPhaseStatus = new Set(['starting', 'recording', 'paused', 'stopping'])
  if (row.deleted_at) {
    // 삭제된 행 뒤에 도착한 available 이벤트는 늦은 direct-upload 객체만 정리하고
    // 로컬 행을 되살리지 않는다.
    if (provider.status === 'available' && !row.r2_key) {
      await adoptDirectRecordingFromR2(env, {
        ...row,
        filename: provider.filename || row.filename,
        stoppedAt: provider.stoppedAt,
      })
    }
    return { ...row, session, noCopy: true }
  }

  if (
    (row.storage_status === 'stored' && row.status === 'available') ||
    (row.status === 'processing' && lowerPhaseStatus.has(provider.status))
  ) {
    // 서로 다른 UUID의 늦은 이벤트가 이미 저장된/후처리 중인 녹화를 다시
    // recording 또는 paused 상태로 되돌리지 못하게 한다.
    if (provider.status !== 'available') return { ...row, session, noCopy: true }
  }

  if (provider.status === 'available' && row.r2_key && row.storage_status === 'stored') {
    await env.DB.prepare(
      `UPDATE interview_recordings
          SET provider_session_id = COALESCE(?, provider_session_id), status = 'available',
              size_bytes = COALESCE(?, size_bytes),
              duration_seconds = COALESCE(?, duration_seconds),
              filename = COALESCE(?, filename), started_at = COALESCE(?, started_at),
              stopped_at = COALESCE(?, stopped_at), updated_at = datetime('now')
        WHERE id = ? AND deleted_at IS NULL`
    )
      .bind(
        provider.providerSessionId,
        provider.sizeBytes,
        provider.durationSeconds,
        provider.filename,
        provider.startedAt,
        provider.stoppedAt,
        row.id
      )
      .run()
    return { ...row, ...provider, session, noCopy: true }
  }

  if (provider.status === 'available' && !row.r2_key) {
    const adopted = await adoptDirectRecordingFromR2(env, {
      ...row,
      filename: provider.filename || row.filename,
      stoppedAt: provider.stoppedAt,
    })
    if (adopted) {
      await env.DB.prepare(
        `UPDATE interview_recordings
            SET provider_session_id = COALESCE(?, provider_session_id),
                duration_seconds = COALESCE(?, duration_seconds),
                started_at = COALESCE(?, started_at), updated_at = datetime('now')
          WHERE id = ?`
      )
        .bind(
          provider.providerSessionId,
          provider.durationSeconds,
          provider.startedAt,
          row.id
        )
        .run()
      return { ...row, ...provider, r2_key: adopted.key, session, noCopy: true }
    }
  }

  const providerReady = provider.status === 'available' && !row.r2_key
  const status = providerReady ? 'processing' : provider.status || row.status
  const storageStatus = providerReady
    ? 'copy_failed'
    : provider.status === 'failed'
      ? 'copy_failed'
      : row.storage_status
  const failureReason = providerReady
    ? 'recording_object_not_found'
    : provider.status === 'failed'
      ? 'provider_recording_failed'
      : null
  await env.DB.prepare(
    `UPDATE interview_recordings
        SET provider_session_id = COALESCE(?, provider_session_id), status = ?,
            storage_status = ?, provider_download_url = NULL,
            provider_download_url_expires_at = NULL,
            size_bytes = COALESCE(?, size_bytes),
            duration_seconds = COALESCE(?, duration_seconds),
            filename = COALESCE(?, filename),
            started_at = COALESCE(?, started_at), stopped_at = COALESCE(?, stopped_at),
            failure_reason = COALESCE(?, failure_reason),
            updated_at = datetime('now')
      WHERE id = ? AND deleted_at IS NULL
        AND NOT (storage_status = 'stored' AND status = 'available')
        AND NOT (status = 'processing' AND ? IN ('starting','recording','paused','stopping'))`
  )
    .bind(
      provider.providerSessionId,
      status,
      storageStatus,
      provider.sizeBytes,
      provider.durationSeconds,
      provider.filename,
      provider.startedAt,
      provider.stoppedAt,
      failureReason,
      row.id,
      provider.status || row.status
    )
    .run()
  return { ...row, ...provider, session, noCopy: true }
}

export async function applyEvent(env, parsed, session) {
  if (!session) return null
  if (parsed.type === 'meeting.started') {
    await env.DB.prepare(
      `UPDATE interview_sessions
          SET status = 'live', provider_session_id = COALESCE(?, provider_session_id),
              started_at = COALESCE(started_at, ?, datetime('now')), updated_at = datetime('now')
        WHERE id = ? AND status NOT IN ('ended','cancelled','failed')`
    )
      .bind(parsed.providerSessionId, parsed.startedAt, session.id)
      .run()
  } else if (parsed.type === 'meeting.ended') {
    // Webhook이 끝났다는 사실만으로 기존 참가자 토큰이 폐기된다고 가정하지 않는다.
    // 공급자 meeting을 먼저 재사용 불가능하게 만든 뒤에만 로컬 종료를 확정한다.
    try {
      await deleteMeeting(env, { meetingId: session.provider_meeting_id })
    } catch (error) {
      if (!isRealtimeKitAlreadyEnded(error)) throw error
    }
    await env.DB.prepare(
      `UPDATE interview_sessions
          SET status = 'ended', provider_session_id = COALESCE(?, provider_session_id),
              ended_at = COALESCE(?, datetime('now')), updated_at = datetime('now')
        WHERE id = ? AND status <> 'cancelled'`
    )
      .bind(parsed.providerSessionId, parsed.endedAt, session.id)
      .run()
  } else if (parsed.type === 'meeting.participantJoined') {
    await env.DB.prepare(
      `UPDATE interview_session_members
          SET provider_peer_id = COALESCE(?, provider_peer_id),
              joined_at = COALESCE(joined_at, ?, datetime('now')), left_at = NULL,
              updated_at = datetime('now')
        WHERE interview_session_members.session_id = ? AND custom_participant_id = ?
          AND EXISTS (
            SELECT 1 FROM interview_sessions s
             WHERE s.id = interview_session_members.session_id
               AND s.status IN ('scheduled','waiting','live')
               AND (
                 s.recording_required = 0 OR EXISTS (
                   SELECT 1 FROM interview_recording_consents c
                    WHERE c.session_id = interview_session_members.session_id
                      AND c.user_id = interview_session_members.user_id
                      AND c.notice_version = ? AND c.notice_hash = ?
                      AND c.granted = 1 AND c.revoked_at IS NULL
                 )
               )
          )
          AND (
            left_at IS NULL OR
            datetime(COALESCE(?, 'now')) > datetime(left_at)
          )`
    )
      .bind(
        parsed.participant.peerId,
        parsed.participant.joinedAt,
        session.id,
        parsed.participant.customParticipantId,
        CONSENT_NOTICE_VERSION,
        CONSENT_NOTICE_HASH,
        parsed.participant.joinedAt
      )
      .run()
  } else if (parsed.type === 'meeting.participantLeft') {
    await env.DB.prepare(
      `UPDATE interview_session_members
          SET provider_peer_id = COALESCE(?, provider_peer_id),
              left_at = COALESCE(?, datetime('now')), updated_at = datetime('now')
        WHERE session_id = ? AND custom_participant_id = ?
          AND (
            joined_at IS NULL OR
            datetime(COALESCE(?, 'now')) >= datetime(joined_at)
          )`
    )
      .bind(
        parsed.participant.peerId,
        parsed.participant.leftAt,
        session.id,
        parsed.participant.customParticipantId,
        parsed.participant.leftAt
      )
      .run()
  } else if (parsed.type === 'recording.statusUpdate') {
    return updateRecording(env, parsed, session)
  }
  return null
}

export async function onRequestPost({ request, env }) {
  const signature = request.headers.get('rtk-signature')
  const eventId = request.headers.get('rtk-uuid')
  if (!signature || !eventId) return jsonError('Webhook 인증 헤더가 없습니다.', 400)
  const contentLength = Number(request.headers.get('Content-Length') || 0)
  if (contentLength > MAX_WEBHOOK_BYTES) return jsonError('Webhook 본문이 너무 큽니다.', 413)

  const rawBody = await request.arrayBuffer()
  if (rawBody.byteLength > MAX_WEBHOOK_BYTES) return jsonError('Webhook 본문이 너무 큽니다.', 413)
  let verified = false
  try {
    const publicKey = await loadWebhookPublicKey(env)
    verified = await verifyWebhookSignature(
      publicKey,
      signature,
      rawBody
    )
  } catch (error) {
    console.error('RealtimeKit webhook public key is invalid:', error)
    return jsonError('Webhook 공개 키를 읽을 수 없습니다.', 503)
  }
  if (!verified) return jsonError('Webhook 서명이 올바르지 않습니다.', 401)

  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody))
  } catch {
    return jsonError('Webhook 본문을 읽을 수 없습니다.', 400)
  }
  const parsed = parseRealtimeKitEvent(payload)
  if (!parsed) return jsonError('Webhook 이벤트 형식을 확인할 수 없습니다.', 400)

  const session = await findSession(env, parsed.providerMeetingId)
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO interview_events
       (id, session_id, provider_event_id, event_type, details_json, occurred_at,
        processing_started_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  )
    .bind(
      eventId,
      session?.id ?? null,
      eventId,
      parsed.type,
      JSON.stringify(safeEventDetails(parsed)),
      parsed.startedAt || parsed.endedAt || parsed.participant.joinedAt || parsed.participant.leftAt
    )
    .run()

  if (inserted.meta?.changes === 0) {
    const previous = await env.DB.prepare(
      'SELECT processed_at, processing_started_at FROM interview_events WHERE provider_event_id = ?'
    )
      .bind(eventId)
      .first()
    if (previous?.processed_at) return jsonResponse({ ok: true, duplicate: true })
    const claimed = await env.DB.prepare(
      `UPDATE interview_events
          SET processing_started_at = datetime('now')
        WHERE provider_event_id = ? AND processed_at IS NULL
          AND (processing_started_at IS NULL
               OR datetime(processing_started_at) <= datetime('now', '-10 minutes'))`
    )
      .bind(eventId)
      .run()
    if (claimed.meta?.changes === 0) {
      // 아직 처리 중인 첫 요청이 실패할 수 있으므로 성공 계열 응답으로 소비시키지
      // 않는다. RTK가 같은 UUID를 다시 보내면 성공 완료 여부를 재확인한다.
      return jsonError('같은 Webhook 이벤트를 처리 중입니다.', 503)
    }
  }

  try {
    const copyTask = await applyEvent(env, parsed, session)
    await env.DB.prepare(
      `UPDATE interview_events
          SET details_json = ?, processed_at = datetime('now'), processing_started_at = NULL
        WHERE provider_event_id = ?`
    )
      .bind(JSON.stringify(safeEventDetails(parsed, copyTask?.id ?? null)), eventId)
      .run()
  } catch (error) {
    console.error(`RealtimeKit webhook processing failed (${eventId}):`, error)
    await env.DB.prepare(
      `UPDATE interview_events SET processing_started_at = NULL
        WHERE provider_event_id = ? AND processed_at IS NULL`
    )
      .bind(eventId)
      .run()
      .catch(() => {})
    return jsonError('Webhook 이벤트를 저장하지 못했습니다.', 500)
  }
  return jsonResponse({ ok: true })
}
