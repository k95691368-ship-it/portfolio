// 갱신으로 이어진 계약을 거슬러 올라가 계속근로기간을 세운다.
//
// 이 조회가 계약서 화면 안에만 있었다. 그래서 계약 전 검토는 계속근로 2년
// 초과(기간제법 제4조 — 2년을 넘으면 기간의 정함이 없는 근로계약으로 본다)를
// 아예 검사하지 않았고, 같은 방을 두고 두 화면의 판정이 갈렸다. 계약서를 쓰기
// 전에 "괜찮다"고 한 것이 계약서에서 high 위반으로 뒤집히면, 두 화면 중
// 하나는 반드시 거짓말을 한 것이 된다.
//
// 두 곳이 같은 함수를 쓰게 한다.

import { describeContinuousEmployment } from './contractPeriod.js'

// 무한히 거슬러 오르지 않는다. 잘못 연결된 고리가 있어도 여기서 멈춘다.
const MAX_CHAIN_DEPTH = 10

export async function loadContinuity(env, roomId, termsRow) {
  if (!termsRow?.previous_room_id) {
    return { linked: false, count: termsRow ? 1 : 0 }
  }

  const { results: chain } = await env.DB.prepare(
    `WITH RECURSIVE chain(room_id, previous_room_id, depth) AS (
       SELECT room_id, previous_room_id, 0 FROM contract_terms WHERE room_id = ?1
       UNION ALL
       SELECT ct.room_id, ct.previous_room_id, chain.depth + 1
         FROM contract_terms ct, chain
        WHERE ct.room_id = chain.previous_room_id AND chain.depth < ?2
     )
     SELECT chain.depth, ct.room_id, ct.contract_start_date, ct.contract_end_date, r.title
       FROM chain
       JOIN contract_terms ct ON ct.room_id = chain.room_id
       JOIN interview_rooms r ON r.id = chain.room_id
      ORDER BY chain.depth DESC`
  )
    .bind(roomId, MAX_CHAIN_DEPTH)
    .all()

  const continuity = describeContinuousEmployment(
    (chain || []).map((c) => ({
      roomId: c.room_id,
      title: c.title,
      startDate: c.contract_start_date,
      endDate: c.contract_end_date,
    }))
  )
  continuity.previousRoomId = termsRow.previous_room_id
  // 위 조회는 열 단계까지만 거슬러 올라간다. 거기서 끊겼다면 합산된 기간이
  // 실제보다 짧다는 뜻이므로, 그 사실을 감추지 않고 함께 알린다.
  continuity.truncated = (chain || []).some((c) => c.depth >= MAX_CHAIN_DEPTH)
  return continuity
}
