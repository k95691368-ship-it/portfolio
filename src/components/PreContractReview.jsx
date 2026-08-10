import { useState } from 'react'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import SeverityBadge from './SeverityBadge.jsx'

// 계약서를 쓰기 전에 대화를 검토한다.
//
// 법령 점검은 계약서에 값이 다 채워진 뒤라야 돌았다. 그런데 조건은 계약서에
// 적히기 훨씬 전에 대화에서 정해지고, 한 번 확정되면 되돌리기 어려워진다.
// 확정 뒤에 조건을 고치는 것이 이 앱이 막으려는 실질적 취소이기 때문이다.
//
// 두 겹으로 보여 준다. 값으로 계산한 것과, 맥락으로 읽은 것.
export default function PreContractReview({ roomId }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const run = async () => {
    setBusy(true)
    try {
      const data = await api.post(`/rooms/${roomId}/negotiation-check`, {})
      setResult(data)
      if (data.reviewError) toast.info('AI 검토는 실행하지 못했습니다. 계산 결과만 표시합니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const d = result?.deterministic
  const r = result?.review

  return (
    <section className="pre-contract-review">
      <h2>계약서 쓰기 전 검토</h2>
      <p className="period-detail">
        지금까지 대화에서 정해진 조건으로 미리 점검합니다. 채용이 확정된 뒤에 조건을 바꾸는 것은
        근로조건의 불이익 변경이라, 확정되기 전에 잡는 편이 훨씬 낫습니다.
      </p>

      <button type="button" className="btn-primary" onClick={run} disabled={busy}>
        {busy ? '검토하는 중...' : '지금 대화로 검토하기'}
      </button>

      {result && (
        <div className="review-result">
          {/* 값으로 계산한 것 — 크레딧과 무관하게 언제나 나온다. */}
          <div className="review-block">
            <h3>
              법정 계산
              {d?.ready ? (
                <span className="badge badge-success">지금 써도 됩니다</span>
              ) : (
                <span className="badge badge-warning">아직 남은 것이 있습니다</span>
              )}
            </h3>

            {d?.issues?.length > 0 ? (
              <ul className="presign-list">
                {d.issues.map((i, n) => (
                  <li key={n}>
                    <SeverityBadge severity={i.severity}>{i.title}</SeverityBadge> {i.detail}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="period-detail">지금 정해진 값에서는 위법 소지가 발견되지 않았습니다.</p>
            )}

            {d?.pending?.length > 0 && (
              <>
                <h4>아직 정해지지 않은 것</h4>
                <p className="period-detail">
                  근로기준법 제17조가 계약서에 명시하도록 정한 항목입니다. 비어 있는 것이 잘못은
                  아니고, 계약서를 쓰기 전에 정하면 됩니다.
                </p>
                <ul className="presign-list">
                  {d.pending.map((p) => (
                    <li key={p.field}>
                      <span className="badge badge-neutral">{p.label}</span>
                      {p.note ? ` ${p.note}` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {d?.postingComparison?.issues?.length > 0 && (
              <>
                <h4>공고와 다른 점</h4>
                <ul className="presign-list">
                  {d.postingComparison.issues.map((i) => (
                    <li key={i.field}>
                      <SeverityBadge severity={i.severity}>{i.label}</SeverityBadge> {i.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* 맥락으로 읽은 것 — 계산으로는 닿지 않는 자리. */}
          <div className="review-block">
            <h3>AI 검토</h3>
            {result.reviewError ? (
              <p className="period-alert">{result.reviewError}</p>
            ) : r ? (
              <>
                <p className="review-summary">{r.summary}</p>

                {r.legal_issues?.length > 0 && (
                  <>
                    <h4>법적으로 걸리는 것</h4>
                    <ul className="presign-list">
                      {r.legal_issues.map((i, n) => (
                        <li key={n}>
                          <SeverityBadge severity={i.severity}>{i.title}</SeverityBadge> {i.detail}
                          {i.law && <span className="review-law"> ({i.law})</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {r.missing?.length > 0 && (
                  <>
                    <h4>대화에서 한 번도 정하지 않은 것</h4>
                    <ul className="presign-list">
                      {r.missing.map((m, n) => (
                        <li key={n}>
                          <span className="badge badge-neutral">{m.item}</span> {m.why}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {r.mismatches?.length > 0 && (
                  <>
                    <h4>양측이 다르게 이해하고 있는 것</h4>
                    <ul className="presign-list">
                      {r.mismatches.map((m, n) => (
                        <li key={n}>
                          <span className="badge badge-warning">{m.item}</span> 회사: {m.company} /
                          지원자: {m.candidate}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {r.ambiguous?.length > 0 && (
                  <>
                    <h4>나중에 다툼이 될 표현</h4>
                    <ul className="presign-list">
                      {r.ambiguous.map((a, n) => (
                        <li key={n}>
                          <blockquote className="review-quote">{a.quote}</blockquote>
                          {a.why}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {r.agreed?.length > 0 && (
                  <>
                    <h4>합의된 것으로 보이는 것</h4>
                    <ul className="presign-list">
                      {r.agreed.map((a, n) => (
                        <li key={n}>
                          <span className="badge badge-success">{a.item}</span> {a.value}
                          {a.basis && <span className="review-basis"> — “{a.basis}”</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <p className="period-detail">
                  AI 검토는 맥락을 읽은 결과라 같은 대화에서도 답이 달라질 수 있습니다. 서명을 실제로
                  막는 것은 위 법정 계산이며, 이 결과는 사람이 읽고 판단할 재료입니다.
                </p>
              </>
            ) : (
              <p className="period-detail">검토 결과가 없습니다.</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
