import { useState } from 'react'
import { formatKst } from '../lib/formatTime.js'

// 처우 협의 이력 — 계약서에 적히기 전에 대화에서 정해진 것들.
//
// 채팅 로그를 다시 읽으면 다 있다. 그런데 수백 줄 안에서 "임금을 언제 얼마로
// 말했는가"를 찾아내는 것과, 그것만 뽑아 시간순으로 늘어놓은 것은 다르다.
// 나중에 다툼이 생겼을 때 필요한 것은 후자다.
export default function NegotiationLog({ negotiation }) {
  const [openAll, setOpenAll] = useState(false)

  if (!negotiation || negotiation.count === 0) return null

  const shown = openAll ? negotiation.entries : negotiation.latest
  const roleLabel = (r) => (r === 'company' ? '회사' : r === 'candidate' ? '지원자' : r)

  return (
    <section className="negotiation-log">
      <h2>처우 협의 기록</h2>
      <p className="period-detail">
        대화에서 오간 근로조건을 자동으로 모았습니다. 계약서를 쓰기 전에 정해진 것들이라, 나중에
        “그렇게 말한 적 없다”는 다툼이 생겼을 때 언제 누가 무엇을 말했는지가 여기 남습니다.
      </p>

      <ul className="negotiation-entries">
        {shown.map((e, i) => (
          <li key={`${e.field}-${e.at}-${i}`}>
            <div className="negotiation-head">
              <span className="negotiation-field">{e.label}</span>
              <span className="negotiation-value">{e.value}</span>
              {e.previousValue && (
                <span className="negotiation-prev">이전 {e.previousValue}</span>
              )}
            </div>
            <div className="negotiation-meta">
              {roleLabel(e.role)} · {formatKst(e.at)}
            </div>
            <blockquote className="negotiation-excerpt">{e.excerpt}</blockquote>
          </li>
        ))}
      </ul>

      {negotiation.entries.length > negotiation.latest.length && (
        <button type="button" className="btn-sm" onClick={() => setOpenAll((v) => !v)}>
          {openAll
            ? '최근 값만 보기'
            : `바뀐 과정 모두 보기 (${negotiation.entries.length}건)`}
        </button>
      )}
    </section>
  )
}
