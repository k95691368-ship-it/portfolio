import { useState } from 'react'
import Fold from '../Fold.jsx'
import EmploymentEnd from './EmploymentEnd.jsx'

// 계약 기간 — 체결로 끝이 아니라 만료까지 관리해야 한다.
// 이어진 계약(갱신) — 계속근로기간 합산과 보존 의무 기간
export default function ContractLifecycle({
  continuity,
  retention,
  linkableRooms,
  canLink,
  onLink,
  onUnlink,
  busy,
  employmentEnd,
  canRecordEnd,
  onRecordEnd,
  onClearEnd,
}) {
  const [selected, setSelected] = useState('')
  const showPicker = canLink && linkableRooms.length > 0
  if (!continuity?.linked && !retention?.known && !showPicker && !canRecordEnd) return null

  // 닫힌 줄에 적을 말. 이어진 계약 건수와 종료 기록 여부가 안 적히면 접힌 채로
  // 영영 안 열린다 — 계속근로기간은 퇴직금이 걸린 값이다.
  const hint =
    [
      continuity?.linked ? `이어진 계약 ${continuity.count}건` : null,
      employmentEnd?.endedAt ? '근로관계 종료 기록됨' : null,
      retention?.known ? retention.label : null,
    ]
      .filter(Boolean)
      .join(' · ') || '이어진 계약 없음'

  return (
    <Fold className="contract-lifecycle" title="계약 이력과 보존" hint={hint}>

      {continuity?.linked && (
        <>
          <p className="period-detail">
            이어진 계약 {continuity.count}건 · 계속근로기간 약 {continuity.totalMonths}개월 (
            {continuity.startDate} ~ {continuity.endDate ?? '진행 중'})
          </p>
          <ol className="lifecycle-chain">
            {continuity.segments.map((s) => (
              <li key={s.roomId}>
                <span>{s.title}</span>
                <span className="lifecycle-dates">
                  {s.startDate} ~ {s.endDate ?? '진행 중'}
                </span>
              </li>
            ))}
          </ol>
          {continuity.exceedsFixedTermLimit && (
            <p className="period-alert">
              계약 하나하나는 2년 이내지만 이어서 보면 2년을 넘습니다. 기간제법 제4조에 따라 기간의
              정함이 없는 근로계약으로 보게 될 수 있습니다.
            </p>
          )}
          {continuity.truncated && (
            <p className="period-alert">
              이어진 계약이 너무 많아 일부까지만 합산했습니다. 실제 계속근로기간은 아래에 표시된
              것보다 깁니다.
            </p>
          )}
          {continuity.gaps?.length > 0 && (
            <p className="period-detail">
              계약 사이에 {continuity.gaps.map((g) => `${g.days}일`).join(', ')}의 공백이 있어 계속근로로
              볼지는 실제 근무 여부에 따라 달라질 수 있습니다.
            </p>
          )}
          {canLink && (
            <button type="button" className="btn-sm" onClick={onUnlink} disabled={busy}>
              연결 해제
            </button>
          )}
        </>
      )}

      {showPicker && !continuity?.linked && (
        <div className="lifecycle-link">
          <p className="period-detail">
            이 계약이 이전 계약의 갱신이라면 이어두세요. 계속근로기간을 합산해 2년 상한을 함께
            봅니다.
          </p>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">이전 계약 선택</option>
            {linkableRooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} ({r.startDate ?? '개시일 미기재'} ~ {r.endDate ?? '종료일 없음'})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-sm"
            onClick={() => onLink(selected)}
            disabled={busy || !selected}
          >
            이전 계약으로 연결
          </button>
        </div>
      )}

      {retention?.known && (
        <p className={retention.expired ? 'period-alert' : 'period-detail'}>
          {/* 재직 중은 "보존 의무가 계속된다"는 뜻이지 문제가 아니다. 만료가
              지난 경우만 눈에 띄게 표시한다. */}
          <span className={`badge ${retention.expired ? 'badge-warning' : 'badge-neutral'}`}>
            {retention.label}
          </span>{' '}
          {retention.detail}
        </p>
      )}

      <EmploymentEnd
        employmentEnd={employmentEnd}
        canRecord={canRecordEnd}
        onRecord={onRecordEnd}
        onClear={onClearEnd}
        busy={busy}
      />
    </Fold>
  )
}
