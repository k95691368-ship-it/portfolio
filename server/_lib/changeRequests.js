import { FIELD_LABELS } from './contractCheck.js'

// 수정 요청 행을 화면에서 쓰는 형태로 변환. 목록 조회와 계약서 통합 조회가 공유한다.
export function mapRequestRow(r) {
  return {
    id: r.id,
    field: r.field,
    label: FIELD_LABELS[r.field] || r.field,
    currentValue: r.current_value,
    requestedValue: r.requested_value,
    reason: r.reason,
    status: r.status,
    responseNote: r.response_note,
    requestedBy: r.requester_name ?? null,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  }
}
