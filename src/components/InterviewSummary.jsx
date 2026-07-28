import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'

// 면접 대화의 회사 보관용 요약 기록.
//
// 지원자에 대한 평가가 아니라 "무슨 이야기가 오갔는가"의 기록이다. 무엇을
// 근거로 쓴 요약인지 알 수 있도록 작성자·작성 시점·그때까지의 대화 수를
// 함께 보여준다. 대화가 더 오갔으면 다시 정리할 수 있다.
export default function InterviewSummary({ roomId, canWrite, messageCount }) {
  const toast = useToast()
  const [record, setRecord] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const data = await api.get(`/rooms/${roomId}/interview-summary`)
    setRecord(data.summary ? data : null)
  }, [roomId])

  useEffect(() => {
    load().catch(() => {})
  }, [load])

  const handleWrite = async () => {
    setBusy(true)
    try {
      await api.post(`/rooms/${roomId}/interview-summary`, {})
      await load()
      toast.success('면접 요약이 기록되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const summary = record?.summary
  const stale = record && messageCount > record.messageCount

  return (
    <section className="interview-summary">
      <div className="period-head">
        <h2>면접 요약 기록</h2>
        {canWrite && (
          <button type="button" className="btn-sm" onClick={handleWrite} disabled={busy}>
            {busy ? '정리하는 중...' : summary ? '다시 정리하기' : 'AI로 면접 정리하기'}
          </button>
        )}
      </div>

      {!summary && (
        <p className="period-detail">
          아직 기록이 없습니다. 면접 대화를 회사 보관용으로 정리해 둘 수 있습니다. 지원자를 평가하는
          문서가 아니라 오간 내용의 기록이며, 직무와 무관한 개인정보는 담지 않습니다.
        </p>
      )}

      {summary && (
        <>
          <p className="summary-meta">
            {record.author} · {record.createdAt} · 대화 {record.messageCount}건 기준
          </p>
          {stale && (
            <p className="period-alert">
              기록 이후 대화가 {messageCount - record.messageCount}건 더 오갔습니다. 다시 정리하면
              최신 내용이 반영됩니다.
            </p>
          )}

          <p className="summary-overview">{summary.overview}</p>

          {summary.discussedConditions?.length > 0 && (
            <div className="summary-block">
              <h3>오간 근로조건</h3>
              <ul>
                {summary.discussedConditions.map((c, i) => (
                  <li key={i}>
                    <span className={`badge ${c.settled ? 'badge-success' : 'badge-neutral'}`}>
                      {c.settled ? '합의' : '협의 중'}
                    </span>{' '}
                    <strong>{c.topic}</strong> — {c.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.candidateStatements?.length > 0 && (
            <div className="summary-block">
              <h3>지원자가 밝힌 내용</h3>
              <ul>
                {summary.candidateStatements.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {summary.openQuestions?.length > 0 && (
            <div className="summary-block">
              <h3>아직 정해지지 않은 것</h3>
              <ul>
                {summary.openQuestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {summary.nextSteps?.length > 0 && (
            <div className="summary-block">
              <h3>다음 절차</h3>
              <ul>
                {summary.nextSteps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
