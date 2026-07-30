import { useState } from 'react'

// 근로자를 위한 계약 해설.
//
// 이 앱의 계산과 AI는 지금까지 거의 전부 회사 쪽을 도왔다. 근로자가 받는 것은
// 위반 경고와 수정 요청 버튼뿐이고, "내가 지금 어떤 계약에 서명하려는가"는 표에
// 적힌 값을 스스로 해석해야 했다.
//
// 계약서에 적힌 값만으로는 알 수 없는 것들이 있다 — 기본급 220만원이 적법한지는
// 근무시간을 알아야 하고, "09:00~18:00"이 몇 시간인지는 휴게시간을 빼야 하고,
// 2년 계약이 무기계약 전환 대상인지는 날짜를 세어야 한다. 그 계산 결과를
// 문장으로 보여 준다.
const TONE_CLASS = {
  ok: 'explain-ok',
  caution: 'explain-caution',
  info: 'explain-info',
}

export default function ContractExplainer({ explanation, myRole }) {
  const [open, setOpen] = useState(myRole === 'candidate')
  if (!explanation) return null

  const forWorker = myRole === 'candidate'

  return (
    <section className="contract-explainer">
      <div className="period-head">
        <h2>{forWorker ? '내 계약 해설' : '근로자에게 보이는 계약 해설'}</h2>
        <span
          className={`badge ${explanation.cautionCount === 0 ? 'badge-success' : 'badge-warning'}`}
        >
          {explanation.cautionCount === 0 ? '확인할 항목 없음' : `확인 ${explanation.cautionCount}건`}
        </span>
      </div>

      <p className={explanation.cautionCount === 0 ? 'period-detail' : 'period-alert'}>
        {explanation.summary}
      </p>
      {!forWorker && (
        <p className="explain-note">
          근로자가 자기 계약을 이해할 수 있도록, 계약서에 적힌 값에서 환산 시급·하루 실근로시간·
          법정 한도 여부를 계산해 보여 줍니다. AI가 아니라 코드로 계산하므로 같은 계약이면 언제나
          같은 설명이 나옵니다.
        </p>
      )}

      <button
        type="button"
        className="btn-sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="contract-explainer-body"
      >
        {open ? '접기' : '자세히 보기'}
      </button>

      {open && (
        <div className="explain-body" id="contract-explainer-body">
          {explanation.sections.map((section) => (
            <div className="explain-section" key={section.title}>
              <h3>{section.title}</h3>
              <ul>
                {section.lines.map((l, i) => (
                  <li key={i} className={TONE_CLASS[l.tone] || 'explain-info'}>
                    {l.label && <span className="explain-label">{l.label}</span>}
                    <span className="explain-value">{l.value}</span>
                    {/* 왜 그런 숫자가 나왔는지 근거를 함께 보여 준다 */}
                    {l.note && <span className="explain-reason">{l.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
