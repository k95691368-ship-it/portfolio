const ROOM_STATUS = {
  open: { label: '모집중', badgeClass: 'badge-neutral' },
  active: { label: '진행중', badgeClass: 'badge-accent' },
  contract_pending: { label: '계약 대기', badgeClass: 'badge-warning' },
  signed: { label: '계약 완료', badgeClass: 'badge-success' },
}

export function roomStatusInfo(status) {
  return ROOM_STATUS[status] ?? { label: status, badgeClass: 'badge-neutral' }
}
