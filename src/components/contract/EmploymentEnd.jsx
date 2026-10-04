import { useState } from 'react'

// 근로관계가 실제로 끝난 날 — 보존 기간(제42조)의 기산일.
export default function EmploymentEnd({ employmentEnd, canRecord, onRecord, onClear, busy }) {
  const [endedOn, setEndedOn] = useState('')
  const [reason, setReason] = useState('')

  if (!canRecord && !employmentEnd?.endedAt) return null

  if (employmentEnd?.endedAt) {
    return (
      <div className="employment-end">
        <p className="period-detail">
          근로관계 종료 <strong>{employmentEnd.endedAt}</strong>
          {employmentEnd.reason && ` · ${employmentEnd.reason}`}
        </p>
        {canRecord && (
          <button type="button" className="btn-sm" onClick={onClear} disabled={busy}>
            종료 기록 취소
          </button>
        )}
      </div>
    )
  }

  return (
    <form
      className="employment-end"
      onSubmit={(e) => {
        e.preventDefault()
        onRecord({ endedOn, reason })
      }}
    >
      <p className="period-detail">
        근로관계가 끝났다면 그 날짜를 기록해주세요. 보존 기간 3년은 계약 종료일이 아니라 실제로 근로관계가
        끝난 날부터 셉니다 (근로기준법 시행령 제22조 제2항).
      </p>
      <div className="career-row">
        <label>
          근로관계 종료일
          <input type="date" value={endedOn} onChange={(e) => setEndedOn(e.target.value)} required />
        </label>
        <label>
          사유 (선택)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder="예: 계약기간 만료"
          />
        </label>
      </div>
      <button type="submit" className="btn-sm" disabled={busy || !endedOn}>
        종료 기록하기
      </button>
    </form>
  )
}
