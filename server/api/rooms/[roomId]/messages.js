import { jsonResponse, jsonError } from '../../../_lib/http.js'
import {
  InterviewAccessError,
  getInterviewSessionAccess,
} from '../../../_lib/interviews.js'
import { blockedWhenArchived } from '../../../_lib/roomLifecycle.js'
import { getRoomAccess, getRoomParticipation } from '../../../_lib/rooms.js'
import { extractTermsFromMessage, selectNewEntries } from '../../../_lib/termsNegotiation.js'
import { scanForOfferSignals } from '../../../_lib/jobOffer.js'
import { alertCandidate, alertCompany } from '../../../_lib/messageAlert.js'

function sessionRoleAsRoomRole(role) {
  if (role === 'host' || role === 'interviewer') return 'company'
  if (role === 'candidate') return 'candidate'
  return null
}

async function getSessionMessageAccess(env, roomId, sessionId, user) {
  let access
  try {
    access = await getInterviewSessionAccess(env, roomId, sessionId, user, {
      allowAdminRead: false,
      allowRoomParticipant: false,
    })
  } catch (error) {
    if (error instanceof InterviewAccessError) return { error }
    throw error
  }
  const roleInRoom = sessionRoleAsRoomRole(access.videoRole)
  if (!roleInRoom) {
    return {
      error: new InterviewAccessError('이 화상 면접의 공개 채팅을 사용할 수 없습니다.', 403),
    }
  }
  return { access, roleInRoom }
}

export async function onRequestGet({ request, env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const url = new URL(request.url)
  const after = Number(url.searchParams.get('after') || 0)
  const interviewSessionId = url.searchParams.get('interviewSessionId')?.trim() || null

  if (interviewSessionId) {
    const sessionAccess = await getSessionMessageAccess(
      env,
      params.roomId,
      interviewSessionId,
      data.user
    )
    if (sessionAccess.error) {
      return jsonError(sessionAccess.error.message, sessionAccess.error.status)
    }
  } else {
    const participant = await getRoomAccess(env, params.roomId, data.user)
    if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  }

  const { results } = await env.DB.prepare(
    `SELECT m.id, m.sender_user_id, m.body, m.created_at, m.interview_session_id,
            u.display_name AS sender_name
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_user_id
     WHERE m.room_id = ? AND m.id > ?
       AND (? IS NULL OR m.interview_session_id = ?)
     ORDER BY m.id ASC
     LIMIT 200`
  )
    .bind(params.roomId, after, interviewSessionId, interviewSessionId)
    .all()

  return jsonResponse({
    messages: results.map((m) => ({
      id: m.id,
      senderId: m.sender_user_id,
      senderName: m.sender_name,
      body: m.body,
      createdAt: m.created_at,
      interviewSessionId: m.interview_session_id ?? null,
    })),
  })
}

export async function onRequestPost({ request, env, data, params, waitUntil }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const body = await request.json().catch(() => null)
  const querySessionId = new URL(request.url).searchParams.get('interviewSessionId')?.trim() || null
  if (
    body &&
    Object.hasOwn(body, 'interviewSessionId') &&
    typeof body.interviewSessionId !== 'string'
  ) {
    return jsonError('화상 면접 세션 정보를 확인해주세요.', 400)
  }
  const interviewSessionId = body?.interviewSessionId?.trim() || null
  // POST의 권한과 저장 scope는 body 한 곳을 정본으로 삼는다. query만 붙은
  // 요청을 일반 방 메시지로 잘못 저장하거나 서로 다른 두 세션을 섞지 않는다.
  if (querySessionId && !interviewSessionId) {
    return jsonError('화상 면접 채팅은 body에 interviewSessionId를 포함해야 합니다.', 400)
  }
  if (querySessionId && querySessionId !== interviewSessionId) {
    return jsonError('query와 body의 화상 면접 세션이 일치하지 않습니다.', 400)
  }

  // 보낸 사람은 언제나 data.user 다.
  //
  // 코드로 들어온 사람도 여기서는 그냥 그 방의 지원자 계정이다 — 미들웨어가
  // 어느 문으로 들어왔는지 보고 이미 정해 놓았다. 예전에는 이 자리에서
  // '계정이 없으면 방의 지원자를 찾아 대신 적는' 갈래가 따로 있었는데, 그것이
  // 회사 계정으로 로그인한 브라우저에서 지원자의 말을 회사 발화로 저장한
  // 원인이었다. 보내는 사람을 여기서 추측하지 않는다.
  //
  // 참여 여부와 방 상태를 한 번에 읽는다. 둘 다 같은 방에 대한 것이고,
  // 대화는 사람이 기다리는 화면이라 왕복 한 번이 그대로 체감된다.
  let room
  let roleInRoom
  if (interviewSessionId) {
    const sessionAccess = await getSessionMessageAccess(
      env,
      params.roomId,
      interviewSessionId,
      data.user
    )
    if (sessionAccess.error) {
      return jsonError(sessionAccess.error.message, sessionAccess.error.status)
    }
    room = sessionAccess.access.room
    roleInRoom = sessionAccess.roleInRoom
  } else {
    room = await getRoomParticipation(env, params.roomId, data.user.id)
    if (!room?.role_in_room) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
    roleInRoom = room.role_in_room
  }
  const senderUserId = data.user.id
  const senderName = data.user.display_name
  const participant = { role_in_room: roleInRoom }

  // 보관된 방에서는 대화도 멈춘다.
  //
  // 종료(closed)와 다른 점이 여기다. 종료된 방에서는 "끝났습니다"를 주고받을
  // 자리가 있어야 해서 대화를 막지 않는다. 보관은 그 자리까지 닫는 것이다.
  const archived = blockedWhenArchived(room, 'message')
  if (archived) return jsonError(archived, 409)

  const text = body?.body?.trim()
  if (!text) return jsonError('메시지 내용을 입력해주세요.', 400)
  if (text.length > 2000) return jsonError('메시지가 너무 깁니다.', 400)

  // 처우 조건이 오갈 때마다 그 자리에서 기록한다.
  //
  // 협의는 계약서를 쓰기 전에 대화에서 먼저 일어난다. 나중에 회사가 "그렇게
  // 말한 적 없다"고 할 때 필요한 것은 채팅 로그 전체가 아니라 "언제 누가 무엇을
  // 말했는가"다. 여기서 남기지 않으면 그 사실은 수백 줄 안에 묻힌다.
  //
  // AI 가 아니라 코드가 읽는다. AI 조건 정리는 회사가 버튼을 눌러야 돌고
  // 크레딧이 없으면 아예 돌지 않는데, 협의는 그동안에도 계속 진행된다.
  //
  // 조건을 읽는 것은 공짜다(정규식). 조건이 들어 있는 메시지에서는 직전 값을
  // 읽어야 하는데, 그 조회는 메시지 저장과 서로를 기다릴 이유가 없다. 함께
  // 보내 왕복을 한 번 줄인다 — 대화는 사람이 기다리는 화면이다.
  const extracted = extractTermsFromMessage({ body: text })

  const [result, previousRows] = await Promise.all([
    env.DB.prepare(
      `INSERT INTO chat_messages (room_id, sender_user_id, body, interview_session_id)
       VALUES (?, ?, ?, ?) RETURNING id, created_at`
    )
      .bind(params.roomId, senderUserId, text, interviewSessionId)
      .first(),
    extracted.length === 0
      ? null
      : env.DB.prepare(
          `SELECT field, value FROM negotiation_log
            WHERE room_id = ? AND id IN (
              SELECT MAX(id) FROM negotiation_log WHERE room_id = ? GROUP BY field
            )`
        )
          .bind(params.roomId, params.roomId)
          .all()
          .catch(() => null),
  ])

  // 기록이 실패해도 메시지 전송까지 되돌리지는 않는다. 대화가 막히는 것이
  // 이력이 한 줄 비는 것보다 나쁘다. 다만 조용히 넘기지 않고 로그에 남긴다.
  const recorded = await recordNegotiation(env, params.roomId, participant.role_in_room, result, {
    extracted,
    previousRows,
  }).catch((err) => {
    console.error(`negotiation_log write failed (${params.roomId}):`, err)
    return []
  })

  // 방금 보낸 이 말이 채용 확정으로 읽히는가.
  //
  // 이 앱의 핵심은 "확정 발화를 보내는 그 순간" 알리는 것이다. 그런데 화면은
  // 방에 들어올 때 한 번 받은 offer 를 들고 있을 뿐이고, 폴링은 메시지만
  // 가져온다. 그래서 "다음 주부터 나오시죠"를 보내도 새로 고치기 전까지는
  // 아무 경고도 뜨지 않았다 — 막아야 할 순간에 아무 말도 하지 않은 셈이다.
  //
  // 방금 보낸 한 건만 훑어 돌려준다. 이력 전체를 다시 읽을 필요가 없고,
  // 화면은 이 신호를 보고 그때만 상태를 다시 불러오면 된다.
  const signal = scanForOfferSignals([{ role_in_room: participant.role_in_room, body: text }])

  // 상대에게 새 메시지가 왔다고 알린다.
  //
  // 두 사람이 이 화면을 쓰는 방식이 다르므로 수단도 다르다. 회사는 일하는 내내
  // 이 사이트를 열어 두므로 컴퓨터 알림이 닿지만(화면 쪽에서 띄운다), 지원자는
  // 코드로 한 번 들어왔다 나가면 그만이라 닿는 통로가 메일뿐이다.
  //
  // 응답을 붙잡아 두지 않는다. 알림 한 번 때문에 보내는 사람이 기다릴 이유가
  // 없고, 실패해도 대화는 이미 저장된 뒤다 -- 알림을 위해 오간 말을 되돌리는
  // 것이 훨씬 나쁘다.
  const alerting = (async () => {
    if (participant.role_in_room === 'company') {
      const candidate = await env.DB.prepare(
        `SELECT u.id, u.email, u.last_seen_at
           FROM room_participants rp JOIN users u ON u.id = rp.user_id
          WHERE rp.room_id = ? AND rp.role_in_room = 'candidate' LIMIT 1`
      )
        .bind(params.roomId)
        .first()
      await alertCandidate(env, {
        roomId: params.roomId,
        room,
        candidate,
        companyName: data.user.company_name || data.user.display_name,
        body: text,
      })
    } else if (participant.role_in_room === 'candidate') {
      const company = await env.DB.prepare(
        'SELECT company_user_id FROM interview_rooms WHERE id = ?'
      )
        .bind(params.roomId)
        .first()
      await alertCompany(env, {
        roomId: params.roomId,
        roomTitle: room.title,
        companyUserId: company?.company_user_id,
        candidateName: data.user.display_name,
      })
    }
  })().catch((err) => console.error(`message alert failed (${params.roomId}):`, err))
  if (waitUntil) waitUntil(alerting)

  return jsonResponse(
    {
      id: result.id,
      senderId: senderUserId,
      senderName,
      body: text,
      createdAt: result.created_at,
      interviewSessionId,
      // 화면이 상태를 다시 불러와야 하는지 판단할 근거. 아무 일도 없었으면
      // 둘 다 비어 있고, 화면은 아무것도 더 하지 않는다.
      offerSignal: { strong: signal.strong, weak: signal.weak },
      negotiationAdded: recorded,
    },
    201
  )
}

// 이 메시지에서 읽어 낸 처우 조건을 이력에 남긴다.
//
// 읽어 낸 값과 직전 값 조회는 호출부에서 메시지 저장과 함께 보낸다. 서로를
// 기다릴 이유가 없는 두 요청이라 왕복이 하나 준다.
async function recordNegotiation(env, roomId, role, message, { extracted, previousRows }) {
  if (extracted.length === 0) return []

  // 같은 값을 여러 번 말하는 것은 협의의 진전이 아니다. 항목별 마지막 값과
  // 다를 때만 남긴다 — 그대로 쌓으면 정작 바뀐 지점이 같은 줄에 묻힌다.
  const previous = previousRows?.results ?? []
  const latestByField = Object.fromEntries(previous.map((r) => [r.field, r.value]))

  const fresh = selectNewEntries(extracted, latestByField)
  if (fresh.length === 0) return []

  await env.DB.batch(
    fresh.map((e) =>
      env.DB.prepare(
        `INSERT INTO negotiation_log
           (room_id, message_id, speaker_role, field, label, value, value_display, previous_value, excerpt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        roomId,
        message?.id ?? null,
        role,
        e.field,
        e.label,
        e.value,
        e.display,
        e.previousValue ?? null,
        e.excerpt
      )
    )
  )

  return fresh.map((e) => ({ field: e.field, label: e.label, display: e.display }))
}
