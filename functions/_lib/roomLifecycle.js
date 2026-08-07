// 면접방의 수명 (순수 함수 — 단위 테스트 대상).
//
// interview_rooms.status 에는 처음부터 'closed'가 정의돼 있었지만 어디서도
// 쓰이지 않았고, closed_at 컬럼은 한 번도 채워진 적이 없다. 그래서 전형이
// 끝나도 방을 닫을 방법이 없었다.
//
// 닫을 수 없다는 것은 생각보다 무겁다.
//
//   다른 후보를 뽑아 끝난 전형이 양쪽 대시보드에 "진행중"으로 영원히 남는다.
//   지원자는 아직 검토 중이라고 믿고 기다린다. 채용절차법 제10조는 구직자에게
//   채용 여부를 알리도록 하는데, 이 서비스에는 "끝났다"고 말할 자리가 없었다.
//
//   더 위험한 쪽은 끝난 방이 여전히 살아 있다는 것이다. 협상이 깨진 방에서
//   회사가 계약 조건을 고치고 서명을 요구할 수 있고, 지원자가 그것을 진행 중인
//   전형으로 오해할 수 있다.

export const ROOM_CLOSED = 'closed'
export const ROOM_SIGNED = 'signed'

// 닫을 수 있는 상태. 체결이 끝난 방은 닫지 않는다 — 그것은 종료가 아니라
// 완료이고, 계약서는 보존 의무가 있는 살아 있는 문서다.
export const CLOSABLE_STATUSES = ['open', 'active', 'contract_pending']

export const CLOSE_REASONS = {
  other_candidate: '다른 지원자를 채용했습니다',
  candidate_withdrew: '지원자가 전형을 그만두었습니다',
  position_cancelled: '채용 자체가 취소되었습니다',
  terms_not_agreed: '근로조건에 합의하지 못했습니다',
  other: '그 밖의 사유',
}

export function isClosed(room) {
  return room?.status === ROOM_CLOSED
}

export function canClose(room) {
  if (!room) return { ok: false, error: '면접방을 찾을 수 없습니다.' }
  if (room.status === ROOM_CLOSED) {
    return { ok: false, error: '이미 종료된 전형입니다.' }
  }
  if (room.status === ROOM_SIGNED) {
    return {
      ok: false,
      error:
        '계약이 체결된 방은 종료할 수 없습니다. 체결된 계약서는 보존 의무가 있는 문서이며, 근로관계가 끝났다면 계약서 화면에서 근로관계 종료일을 기록해주세요.',
    }
  }
  if (!CLOSABLE_STATUSES.includes(room.status)) {
    return { ok: false, error: '이 상태에서는 전형을 종료할 수 없습니다.' }
  }
  return { ok: true }
}

export function normalizeCloseReason(code, note) {
  const key = CLOSE_REASONS[code] ? code : 'other'
  const trimmed = String(note ?? '').trim().slice(0, 200)
  return {
    code: key,
    label: CLOSE_REASONS[key],
    note: trimmed || null,
    text: trimmed ? `${CLOSE_REASONS[key]} · ${trimmed}` : CLOSE_REASONS[key],
  }
}

// 닫힌 방에서 막아야 하는 행동.
//
// 열람과 내려받기는 막지 않는다. 전형이 끝났다고 지금까지의 기록을 못 보게 하면,
// 무슨 일이 있었는지 확인할 길이 사라진다. 막는 것은 "계약을 앞으로 진행하는"
// 행동뿐이다.
const BLOCKED_WHEN_CLOSED = {
  sign: '종료된 전형에서는 서명할 수 없습니다.',
  edit_terms: '종료된 전형의 계약 조건은 수정할 수 없습니다.',
  confirm_hire: '종료된 전형에서는 채용을 확정할 수 없습니다.',
  change_request: '종료된 전형에서는 수정을 요청할 수 없습니다.',
  draft: '종료된 전형에서는 계약서를 작성할 수 없습니다.',
  analyze: '종료된 전형에서는 채용 조건을 다시 정리할 수 없습니다.',
  respond_change_request: '종료된 전형에서는 수정 요청에 응답할 수 없습니다.',
  link_previous: '종료된 전형의 이전 계약 연결은 변경할 수 없습니다.',
}

export function blockedWhenClosed(room, action) {
  if (!isClosed(room)) return null
  return BLOCKED_WHEN_CLOSED[action] ?? '종료된 전형에서는 할 수 없는 작업입니다.'
}
