import { jsonResponse, jsonError } from '../../_lib/http.js'
import { canMessage, partnerView, MAX_BODY } from '../../_lib/dm.js'
import { checkRateLimit, releaseRateLimit } from '../../_lib/rateLimit.js'
import { notifyUser } from '../../_lib/notify.js'
import { pushToUser } from '../../_lib/webPush.js'

// 한 사람과의 대화를 읽는다.
//
// 읽는 김에 읽음 표시까지 한다. 창을 여는 것이 곧 읽는 것이라, 따로
// "읽었다" 를 보내게 하면 그 요청이 실패했을 때 안 읽음 배지만 남는다.
export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const gate = await canMessage(env, data.user, params.partnerId)
  if (!gate.ok) return jsonError(gate.reason, 403)

  const me = data.user.id
  const other = params.partnerId

  const { results } = await env.DB.prepare(
    `SELECT id, sender_id, body, created_at, read_at
       FROM direct_messages
      WHERE (sender_id = ?1 AND recipient_id = ?2) OR (sender_id = ?2 AND recipient_id = ?1)
      ORDER BY id DESC
      LIMIT 200`
  )
    .bind(me, other)
    .all()

  // 받은 것만 읽음으로 바꾼다. 내가 보낸 줄의 read_at 은 상대가 열 때 찍힌다.
  await env.DB.prepare(
    `UPDATE direct_messages SET read_at = datetime('now')
      WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL`
  )
    .bind(me, other)
    .run()
    .catch((err) => console.error('dm read mark failed:', err))

  return jsonResponse({
    partner: partnerView(gate.partner),
    // 질의는 최신순으로 뽑고(LIMIT 이 최근 200줄을 잡아야 한다) 화면에는
    // 시간순으로 준다.
    messages: (results || []).reverse().map((m) => ({
      id: m.id,
      fromMe: m.sender_id === me,
      body: m.body,
      createdAt: m.created_at,
      readAt: m.read_at,
    })),
  })
}

export async function onRequestPost({ env, request, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const gate = await canMessage(env, data.user, params.partnerId)
  if (!gate.ok) return jsonError(gate.reason, 403)

  let body
  try {
    body = (await request.json())?.body
  } catch {
    return jsonError('요청을 읽지 못했습니다.', 400)
  }

  const text = String(body ?? '').trim()
  if (!text) return jsonError('내용을 입력하세요.', 400)
  if (text.length > MAX_BODY) return jsonError(`${MAX_BODY}자를 넘을 수 없습니다.`, 400)

  // 보내는 사람 기준으로 막는다. 받는 사람 기준으로 막으면 한 사람을
  // 조용히 시키려고 아무나 그 사람에게 쏟아부으면 된다.
  //
  // checkRateLimit 은 표를 돌려주지 않는다. 허용이면 방금 기록한 시도의
  // 번호를, 넘었으면 0을 돌려준다. 처음에 { ok } 인 줄 알고 limit.ok 를
  // 읽었는데 그 값은 언제나 undefined 라서 쪽지 보내기가 전부 429 였다 --
  // 단위 테스트로는 안 잡히고 실제로 눌러 봐야만 보이는 자리였다.
  const ticket = await checkRateLimit(env, `dm:${data.user.id}`, 60, 300)
  if (!ticket) return jsonError('쪽지를 너무 빠르게 보내고 있습니다. 잠시 후 다시 시도하세요.', 429)

  let row
  try {
    row = await env.DB.prepare(
      `INSERT INTO direct_messages (sender_id, recipient_id, body) VALUES (?, ?, ?)
       RETURNING id, created_at`
    )
      .bind(data.user.id, params.partnerId, text)
      .first()
  } catch (err) {
    // 못 보낸 것은 세지 않는다. 한도는 "몇 번 보냈는가" 를 세는 것이다.
    await releaseRateLimit(env, `dm:${data.user.id}`, ticket)
    console.error('dm insert failed:', err)
    return jsonError('쪽지를 보내지 못했습니다.', 500)
  }

  const who = data.user.display_name || '상대'
  await notifyUser(env, params.partnerId, {
    type: 'dm',
    // 알림 목록에는 본문을 싣지 않는다. 알림은 스쳐 지나가며 읽히는 것이라
    // 옆에서 보던 사람이 그대로 읽는다. 열어야 보이게 둔다.
    message: `${who}님이 쪽지를 보냈습니다.`,
    link: `/dm/${data.user.id}`,
  })
  // 창을 닫아 둔 사람에게도 닿게 한다. 여기도 본문은 싣지 않는다 --
  // 잠금화면에 뜬다.
  await pushToUser(env, params.partnerId, {
    title: '새 쪽지',
    body: `${who}님이 쪽지를 보냈습니다.`,
    tag: `dm-${data.user.id}`,
    url: `/dm/${data.user.id}`,
  }).catch((err) => console.error('dm push failed:', err))

  return jsonResponse({
    message: {
      id: row.id,
      fromMe: true,
      body: text,
      createdAt: row.created_at,
      readAt: null,
    },
    partner: partnerView(gate.partner),
  })
}
