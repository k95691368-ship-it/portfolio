import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { blockedWhenFrozen } from '../../../_lib/roomLifecycle.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { notifyUser } from '../../../_lib/notify.js'

// 이 계약이 어떤 계약의 갱신인지 이어 붙인다.
//
// 기간제법 제4조의 2년 상한은 계속근로기간으로 따지므로, 1년 계약을 세 번
// 갱신한 경우도 합산해서 봐야 한다. 앞뒤를 이어 두면 서명 전 점검이 그것을
// 합산해 경고할 수 있다.
//
// 아무 계약이나 이을 수는 없다. 같은 근로자의, 이미 체결된 계약만 이을 수 있고,
// 고리가 돌지 않도록 순환도 막는다.
const MAX_CHAIN = 10

async function candidateOf(env, roomId) {
  const row = await env.DB.prepare(
    "SELECT user_id FROM room_participants WHERE room_id = ? AND role_in_room = 'candidate'"
  )
    .bind(roomId)
    .first()
  return row?.user_id ?? null
}

export async function onRequestPost({ request, env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('이전 계약 연결은 회사(고용) 측만 설정할 수 있습니다.', 403)
  }

  const room = await env.DB.prepare('SELECT status, archived_at FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (!room) return jsonError('면접방을 찾을 수 없습니다.', 404)
  if (room.status === 'signed') {
    return jsonError('이미 체결된 계약의 연결은 변경할 수 없습니다.', 409)
  }
  // 규칙은 적어 두고 부르지 않고 있었다. 끝난 전형이 체결된 계약의 '갱신
  // 자리'를 계속 차지하면, 정작 이어받아야 할 새 계약이 연결하지 못한다.
  const closedBlock = blockedWhenFrozen(room, 'link_previous')
  if (closedBlock) return jsonError(closedBlock, 409)

  const body = await request.json().catch(() => null)
  const previousRoomId = body?.previousRoomId
  if (typeof previousRoomId !== 'string' || previousRoomId === '') {
    return jsonError('연결할 이전 계약을 선택해주세요.', 400)
  }
  if (previousRoomId === params.roomId) {
    return jsonError('계약을 자기 자신과 연결할 수 없습니다.', 400)
  }

  const previous = await env.DB.prepare('SELECT id, title, status FROM interview_rooms WHERE id = ?')
    .bind(previousRoomId)
    .first()
  if (!previous) return jsonError('이전 계약을 찾을 수 없습니다.', 404)
  if (previous.status !== 'signed') {
    return jsonError('체결이 완료된 계약만 이전 계약으로 연결할 수 있습니다.', 400)
  }

  // 요청자가 그 계약의 당사자가 아니면 남의 계약을 들여다보는 통로가 된다.
  const inPrevious = await getRoomParticipant(env, previousRoomId, data.user.id)
  if (!inPrevious) return jsonError('참여하지 않은 계약은 연결할 수 없습니다.', 403)

  // 같은 근로자의 계약이어야 계속근로 합산이 의미가 있다.
  const [here, there] = await Promise.all([
    candidateOf(env, params.roomId),
    candidateOf(env, previousRoomId),
  ])
  if (!here || !there || here !== there) {
    return jsonError('같은 근로자의 계약만 이전 계약으로 연결할 수 있습니다.', 400)
  }

  // 한 계약의 갱신은 하나뿐이다. 두 계약이 같은 계약을 이전으로 삼으면
  // 계속근로기간이 두 갈래로 갈라져 어느 쪽도 사실이 아니게 된다.
  const alreadyLinked = await env.DB.prepare(
    `SELECT r.title FROM contract_terms c
       JOIN interview_rooms r ON r.id = c.room_id
      WHERE c.previous_room_id = ? AND c.room_id != ?`
  )
    .bind(previousRoomId, params.roomId)
    .first()
  if (alreadyLinked) {
    return jsonError(
      `이 계약은 이미 다른 계약(${alreadyLinked.title})의 이전 계약으로 연결되어 있습니다.`,
      409
    )
  }

  // 이전 계약을 거슬러 올라가다 이 방이 나오면 고리가 돈다.
  // 동시에 사슬 길이도 센다. 조회 쪽이 일정 깊이까지만 거슬러 올라가므로,
  // 그보다 길어지면 계속근로기간이 실제보다 짧게 계산되고 2년 초과 경고를
  // 놓치게 된다. 그렇게 되기 전에 막는다.
  let cursor = previousRoomId
  let depth = 1
  while (cursor) {
    const row = await env.DB.prepare('SELECT previous_room_id FROM contract_terms WHERE room_id = ?')
      .bind(cursor)
      .first()
    cursor = row?.previous_room_id ?? null
    if (cursor === params.roomId) {
      return jsonError('계약 연결이 순환합니다. 다른 계약을 선택해주세요.', 400)
    }
    if (cursor) depth += 1
    if (depth >= MAX_CHAIN) {
      return jsonError(
        `이어 붙일 수 있는 계약은 ${MAX_CHAIN}건까지입니다. 더 이어지면 계속근로기간이 실제보다 짧게 계산됩니다.`,
        409
      )
    }
  }

  // 위의 SELECT 확인과 이 INSERT 사이에는 트랜잭션이 없다. 두 요청이 같은
  // 계약을 동시에 이전 계약으로 삼으면 둘 다 "아직 없다"를 보고 둘 다 쓴다.
  // 0042 의 부분 유니크 인덱스가 마지막 방어선이므로, 걸렸을 때 사용자에게
  // 무슨 일인지 알린다.
  try {
    await env.DB.prepare(
      `INSERT INTO contract_terms (room_id, previous_room_id) VALUES (?, ?)
       ON CONFLICT(room_id) DO UPDATE SET previous_room_id = excluded.previous_room_id,
         updated_at = datetime('now')`
    )
      .bind(params.roomId, previousRoomId)
      .run()
  } catch (err) {
    if (String(err?.message ?? '').includes('UNIQUE')) {
      return jsonError(
        '그 사이에 다른 계약이 이 계약을 이전 계약으로 연결했습니다. 화면을 새로 고쳐 확인해주세요.',
        409
      )
    }
    throw err
  }

  await notifyUser(env, here, {
    type: 'contract_linked',
    message: `이 계약이 이전 계약(${previous.title})의 갱신으로 연결되었습니다.`,
    link: `/rooms/${params.roomId}/contract`,
  })

  return jsonResponse({ ok: true, previousRoomId })
}

export async function onRequestDelete({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('이전 계약 연결은 회사(고용) 측만 설정할 수 있습니다.', 403)
  }

  const room = await env.DB.prepare('SELECT status, archived_at FROM interview_rooms WHERE id = ?')
    .bind(params.roomId)
    .first()
  if (room?.status === 'signed') {
    return jsonError('이미 체결된 계약의 연결은 변경할 수 없습니다.', 409)
  }
  // 연결(POST)은 막으면서 해제(DELETE)는 열려 있었다. archived_at 을 읽어 놓고
  // 판정을 부르지 않은, 값은 있는데 계산만 꺼진 모양이다.
  //
  // 이쪽이 더 무겁다. previous_room_id 는 계속근로기간 합산의 유일한 근거라,
  // 지우는 순간 "계약 하나하나는 2년 이내지만 이어서 보면 2년을 넘습니다"
  // (기간제법 제4조) 경고가 계약서 화면과 서명 전 점검에서 함께 사라진다.
  // 연결은 막혀 있으므로 되돌릴 수도 없다.
  const frozen = blockedWhenFrozen(room, 'link_previous')
  if (frozen) return jsonError(frozen, 409)

  await env.DB.prepare('UPDATE contract_terms SET previous_room_id = NULL WHERE room_id = ?')
    .bind(params.roomId)
    .run()

  return jsonResponse({ ok: true })
}
