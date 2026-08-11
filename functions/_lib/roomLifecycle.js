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

// 종료돼도 계속할 수 있는 것.
//
// 모르는 작업은 막는 것이 기본이지만, 대화는 분명히 열어 두어야 한다. 끝났다는
// 말을 주고받을 자리까지 닫으면 "왜 끝났는지" 물어볼 곳이 없어진다. 그것을
// 위 목록에 없다는 이유로 막으면, 어느 함수를 부르느냐에 따라 대화가 됐다
// 안 됐다 한다. 뜻을 코드에 적어 둔다.
const ALLOWED_WHEN_CLOSED = new Set(['message'])

export function blockedWhenClosed(room, action) {
  if (!isClosed(room)) return null
  if (ALLOWED_WHEN_CLOSED.has(action)) return null
  return BLOCKED_WHEN_CLOSED[action] ?? '종료된 전형에서는 할 수 없는 작업입니다.'
}

// 보관처리 — 지금 상태 그대로 잠근다.
//
// 종료는 "이 사람으로 진행하지 않는다"는 결정이고 체결은 "계약이 성립했다"는
// 사실이다. 보관은 그 둘 중 어느 쪽이든, 더 일어날 일이 없으니 손대지 못하게
// 하는 일이다. 그래서 status 를 덮지 않고 따로 표시한다 — 덮으면 그 방이
// 종료였는지 체결이었는지가 지워지고, 채용내정을 다투는 자리에서 그 구분이
// 사라지는 것은 기록을 잃는 것과 같다.
//
// 종료와 다른 점이 하나 있다. 종료된 방에서도 대화는 계속할 수 있다 — 끝났다는
// 말을 주고받을 자리는 있어야 하기 때문이다. 보관은 그 자리까지 닫는다.

export function isArchived(room) {
  if (!room) return false
  // 잠금이 조용히 꺼지는 것을 막는다.
  //
  // 호출부는 대부분 'SELECT status FROM interview_rooms' 로 방을 읽는다. 거기에
  // archived_at 을 넣는 것을 잊으면 이 함수는 언제나 false 를 돌려주고, 보관은
  // 걸려 있는데 아무것도 막히지 않는다. 검사는 도는데 검사하려던 것이 빠져
  // 있는, 이 저장소에서 반복된 모양이다.
  //
  // 방 행인 것은 분명한데 그 칸만 없으면 조용히 넘기지 않고 소리를 낸다.
  if (typeof room === 'object' && 'status' in room && !('archived_at' in room)) {
    throw new Error('보관 여부를 확인하려면 interview_rooms.archived_at 을 함께 읽어야 합니다.')
  }
  return !!room.archived_at
}

export function canArchive(room) {
  if (!room) return { ok: false, error: '면접방을 찾을 수 없습니다.' }
  if (isArchived(room)) return { ok: false, error: '이미 보관된 면접방입니다.' }
  return { ok: true }
}

export function canUnarchive(room) {
  if (!room) return { ok: false, error: '면접방을 찾을 수 없습니다.' }
  if (!isArchived(room)) return { ok: false, error: '보관되지 않은 면접방입니다.' }
  return { ok: true }
}

// 보관된 방에서 막아야 하는 행동.
//
// 읽기와 내려받기는 막지 않는다. 보관은 없애는 것이 아니라 굳히는 것이고,
// 무슨 일이 있었는지 확인할 길까지 없애면 보관의 뜻이 사라진다. 계약서를
// 화면에서 보는 것도, 이미 저장된 PDF 를 내려받는 것도 그대로 된다.
//
// 막는 것은 내용을 바꾸는 모든 행동이다 — 대화, 계약 조건, 서명, 계약서
// 파일 저장.
const BLOCKED_WHEN_ARCHIVED = {
  message: '보관된 면접방에서는 대화할 수 없습니다. 보관을 해제한 뒤 이용해주세요.',
  sign: '보관된 면접방에서는 서명할 수 없습니다.',
  edit_terms: '보관된 면접방의 계약 조건은 수정할 수 없습니다.',
  store_contract: '보관된 면접방에서는 계약서 파일을 저장할 수 없습니다.',
  confirm_hire: '보관된 면접방에서는 채용을 확정할 수 없습니다.',
  change_request: '보관된 면접방에서는 수정을 요청할 수 없습니다.',
  draft: '보관된 면접방에서는 계약서를 작성할 수 없습니다.',
  analyze: '보관된 면접방에서는 채용 조건을 다시 정리할 수 없습니다.',
  respond_change_request: '보관된 면접방에서는 수정 요청에 응답할 수 없습니다.',
  link_previous: '보관된 면접방의 이전 계약 연결은 변경할 수 없습니다.',
  translate: '보관된 면접방에서는 계약서를 새로 번역할 수 없습니다.',
  employment_end: '보관된 면접방에서는 근로관계 종료를 기록할 수 없습니다.',
  close: '보관된 면접방은 종료 상태를 바꿀 수 없습니다. 보관을 해제한 뒤 진행해주세요.',
  // 보관된 방에서 최종합격을 통보하는 것은 그 자체로 앞뒤가 맞지 않는다.
  // 합격 통보는 채용내정을 성립시키는 바로 그 행위인데, 정작 그 방에서는
  // 대화도 서명도 할 수 없다. 받은 사람은 답할 곳이 없다.
  final_offer_email: '보관된 면접방에서는 최종합격 이메일을 보낼 수 없습니다. 보관을 해제한 뒤 진행해주세요.',
  invite_email: '보관된 면접방에서는 초대 이메일을 보낼 수 없습니다.',
  interview_summary: '보관된 면접방에서는 면접 요약을 새로 쓸 수 없습니다.',
}

export function blockedWhenArchived(room, action) {
  if (!isArchived(room)) return null
  return BLOCKED_WHEN_ARCHIVED[action] ?? '보관된 면접방에서는 할 수 없는 작업입니다.'
}

// 보관과 종료를 한 번에 본다.
//
// 부르는 쪽이 둘을 따로 확인하게 두면 한쪽을 빠뜨린다 — 이 저장소에서 반복된
// 모양이다. 보관이 더 강한 잠금이므로 먼저 본다.
export function blockedWhenFrozen(room, action) {
  return blockedWhenArchived(room, action) ?? blockedWhenClosed(room, action)
}
