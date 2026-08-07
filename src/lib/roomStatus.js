const ROOM_STATUS = {
  open: { label: '모집중', badgeClass: 'badge-neutral' },
  active: { label: '진행중', badgeClass: 'badge-accent' },
  contract_pending: { label: '계약 대기', badgeClass: 'badge-warning' },
  signed: { label: '계약 완료', badgeClass: 'badge-success' },
  // 체결 없이 끝난 전형. 라벨이 없으면 화면에 'closed'가 영문 그대로 나온다.
  closed: { label: '전형 종료', badgeClass: 'badge-neutral' },
}

export function roomStatusInfo(status) {
  return ROOM_STATUS[status] ?? { label: status, badgeClass: 'badge-neutral' }
}
