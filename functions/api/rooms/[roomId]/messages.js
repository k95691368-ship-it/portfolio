import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomParticipant, getRoomAccess } from '../../../_lib/rooms.js'
import { extractTermsFromMessage, selectNewEntries } from '../../../_lib/termsNegotiation.js'
import { scanForOfferSignals } from '../../../_lib/jobOffer.js'

export async function onRequestGet({ request, env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const participant = await getRoomAccess(env, params.roomId, data.user)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const url = new URL(request.url)
  const after = Number(url.searchParams.get('after') || 0)

  const { results } = await env.DB.prepare(
    `SELECT m.id, m.sender_user_id, m.body, m.created_at, u.display_name AS sender_name
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_user_id
     WHERE m.room_id = ? AND m.id > ?
     ORDER BY m.id ASC
     LIMIT 200`
  )
    .bind(params.roomId, after)
    .all()

  return jsonResponse({
    messages: results.map((m) => ({
      id: m.id,
      senderId: m.sender_user_id,
      senderName: m.sender_name,
      body: m.body,
      createdAt: m.created_at,
    })),
  })
}

export async function onRequestPost({ request, env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const body = await request.json().catch(() => null)
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
      'INSERT INTO chat_messages (room_id, sender_user_id, body) VALUES (?, ?, ?) RETURNING id, created_at'
    )
      .bind(params.roomId, data.user.id, text)
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

  return jsonResponse(
    {
      id: result.id,
      senderId: data.user.id,
      senderName: data.user.display_name,
      body: text,
      createdAt: result.created_at,
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
