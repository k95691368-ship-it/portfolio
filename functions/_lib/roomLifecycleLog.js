// 방에 일어난 일을 그대로 적는다.
//
// 전형 종료·종료 취소·근로관계 종료 기록·그 취소는 상태 컬럼에만 적히고
// 되돌리면 지워졌다. 지워지는 값은 증거가 되지 못한다.

export const LIFECYCLE_ACTIONS = {
  closed: '전형 종료',
  reopened: '전형 종료 취소',
  employment_end_recorded: '근로관계 종료일 기록',
  employment_end_cleared: '근로관계 종료 기록 취소',
}

// 기록에 실패해도 본 작업까지 되돌리지는 않는다. 다만 조용히 넘어가지 않고
// 서버 로그에는 남긴다 — 증거가 빠진 것을 나중에 알아볼 수 있어야 한다.
export async function logLifecycle(env, roomId, { action, actorName, detail = null }) {
  if (!LIFECYCLE_ACTIONS[action]) return
  try {
    await env.DB.prepare(
      'INSERT INTO room_lifecycle_log (room_id, actor_name, action, detail) VALUES (?, ?, ?, ?)'
    )
      .bind(roomId, actorName ?? null, action, detail)
      .run()
  } catch (err) {
    console.error(`room_lifecycle_log write failed (${roomId}/${action}):`, err)
  }
}

export async function listLifecycle(env, roomId) {
  const { results } = await env.DB.prepare(
    'SELECT action, actor_name, detail, created_at FROM room_lifecycle_log WHERE room_id = ? ORDER BY id ASC'
  )
    .bind(roomId)
    .all()
  return results
}

// 감사추적 이벤트로 옮긴다.
export function lifecycleEvents(rows) {
  return (rows || []).map((r) => ({
    at: r.created_at,
    event: LIFECYCLE_ACTIONS[r.action] ?? r.action,
    detail: [r.actor_name, r.detail].filter(Boolean).join(' · ') || null,
  }))
}
