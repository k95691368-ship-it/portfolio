import { useEffect, useState } from 'react'
import Fold from '../Fold.jsx'
import { IDENTITY_FIELDS, TERM_FIELDS } from '../../lib/contractTemplate.js'

const REQUEST_STATUS = {
  pending: { label: '검토 중', badge: 'badge-warning' },
  accepted: { label: '반영됨', badge: 'badge-success' },
  declined: { label: '반려됨', badge: 'badge-neutral' },
}

// 계약 조건 수정 요청 — 지원자가 보내고 회사가 수락·거절한다.
export default function ChangeRequests({ requests, myRole, canRequest, canRespond, onCreate, onRespond, busy, prefill }) {
  const [draft, setDraft] = useState({ field: '', requestedValue: '', reason: '' })
  const [submissionScope] = useState(() => ({ active: true, generation: 0, pending: null }))

  useEffect(() => {
    submissionScope.active = true
    return () => {
      submissionScope.active = false
      submissionScope.generation++
      submissionScope.pending = null
    }
  }, [submissionScope])

  // 점검 결과에서 "이 값으로 수정 요청"을 누르면 폼이 채워진 채로 열린다.
  useEffect(() => {
    if (!prefill) return
    setDraft({ field: prefill.field, requestedValue: prefill.requestedValue, reason: prefill.reason })
  }, [prefill])

  const submit = async (e) => {
    e.preventDefault()
    if (busy || !canRequest || !submissionScope.active || submissionScope.pending) return
    const attempt = { generation: submissionScope.generation }
    submissionScope.pending = attempt
    try {
      const sent = await onCreate({ ...draft })
      if (!sent || !submissionScope.active || submissionScope.generation !== attempt.generation
        || submissionScope.pending !== attempt) return
      // 성공한 요청의 초안만 지운다. 대기 중 편집/새 점검값은 별도 초안이다.
      setDraft(current => current === draft ? { field: '', requestedValue: '', reason: '' } : current)
    } finally {
      if (submissionScope.pending === attempt) submissionScope.pending = null
    }
  }

  const pending = requests.filter((r) => r.status === 'pending')
  const resolved = requests.filter((r) => r.status !== 'pending')

  return (
    <Fold
      className="change-requests"
      title="계약 조건 수정 요청"
      hint={
        pending.length > 0
          ? `검토 중 ${pending.length}건`
          : resolved.length > 0
            ? `답한 것 ${resolved.length}건`
            : '아직 없음'
      }
      defaultOpen={pending.length > 0}
    >

      {pending.length === 0 && resolved.length === 0 && (
        <p className="notice">
          {myRole === 'candidate'
            ? '계약 내용 중 다르게 합의했거나 조정이 필요한 항목이 있으면 수정을 요청할 수 있습니다.'
            : '지원자가 보낸 수정 요청이 여기에 표시됩니다.'}
        </p>
      )}

      {pending.length > 0 && (
        <ul className="request-list">
          {pending.map((r) => (
            <li key={r.id} className="request-item">
              <div className="request-head">
                <strong>{r.label}</strong>
                <span className={`badge ${REQUEST_STATUS.pending.badge}`}>검토 중</span>
              </div>
              <p className="request-values">
                <span className="request-from">{r.currentValue || '(비어 있음)'}</span>
                {' → '}
                <span className="request-to">{r.requestedValue}</span>
              </p>
              {r.reason && <p className="request-reason">사유: {r.reason}</p>}
              {/* 잠긴 방에서는 응답도 막힌다(서버가 409). 버튼만 남겨 두면
                  눌러 봐야 안 되는 화면이 된다. */}
              {myRole === 'company' && canRespond && (
                <div className="request-actions">
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={busy}
                    onClick={() => onRespond(r.id, 'accept')}
                  >
                    수락하고 계약서에 반영
                  </button>
                  <button
                    type="button"
                    className="btn-sm"
                    disabled={busy}
                    onClick={() => onRespond(r.id, 'decline')}
                  >
                    거절
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <ul className="request-list resolved">
          {resolved.map((r) => (
            <li key={r.id} className="request-item">
              <div className="request-head">
                <strong>{r.label}</strong>
                <span className={`badge ${REQUEST_STATUS[r.status].badge}`}>
                  {REQUEST_STATUS[r.status].label}
                </span>
              </div>
              <p className="request-values">
                <span className="request-from">{r.currentValue || '(비어 있음)'}</span>
                {' → '}
                <span className="request-to">{r.requestedValue}</span>
              </p>
              {r.responseNote && <p className="request-reason">회사 회신: {r.responseNote}</p>}
            </li>
          ))}
        </ul>
      )}

      {canRequest && (
        <form className="request-form" onSubmit={submit}>
          <div className="career-row">
            <label>
              항목
              <select value={draft.field} onChange={(e) => {
                const field = e.target.value
                setDraft(current => ({ ...current, field }))
              }} required>
                <option value="">선택</option>
                {[...IDENTITY_FIELDS, ...TERM_FIELDS].map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              요청하는 값
              <input value={draft.requestedValue} onChange={(e) => {
                const requestedValue = e.target.value
                setDraft(current => ({ ...current, requestedValue }))
              }} maxLength={500} required />
            </label>
          </div>
          <label>
            사유 (선택)
            <input
              value={draft.reason}
              onChange={(e) => {
                const reason = e.target.value
                setDraft(current => ({ ...current, reason }))
              }}
              maxLength={500}
              placeholder="예: 면접에서 합의한 금액과 다릅니다."
            />
          </label>
          <button type="submit" className="btn-primary" disabled={busy}>
            수정 요청 보내기
          </button>
        </form>
      )}
    </Fold>
  )
}
