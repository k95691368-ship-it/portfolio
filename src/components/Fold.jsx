// 접어 두는 구획.
//
// 계약 화면 한 장에 구획이 열다섯 개 쌓여 있었다. 서명하러 온 사람이
// 임금구성·해설·권리·대조·교부·기간·이력·번역·수정요청을 전부 지나야
// 서명 자리에 닿았다. 전부 필요한 내용이라 지울 수는 없다. 그래서 접는다.
//
// 접을 때 지키는 규칙이 하나 있다. 닫힌 줄에 무엇이 들었는지 적는다.
// "계약서 교부 ›" 만 있으면 아무도 안 연다. 사람은 안 보이는 것을 없는
// 것으로 친다. "계약서 교부 · 아직 안 보냄" 이라고 적혀 있어야 연다.
//
// 그래서 적을 말(hint 나 badge)이 없으면 이 부품은 접기를 거부하고 그냥
// 펼친 구획으로 그린다. 접었는데 아무 말도 안 하는 줄이 생기느니 예전처럼
// 길어지는 편이 낫다. 어느 자리가 그러고 있는지는 시험이 잡는다.
export default function Fold({ className = '', title, hint, badge, defaultOpen = false, children }) {
  const label = badge ?? (hint ? <span className="fold-hint">{hint}</span> : null)

  if (!label) {
    return (
      <section className={className}>
        <h2>{title}</h2>
        {children}
      </section>
    )
  }

  return (
    <details className={`fold ${className}`.trim()} open={defaultOpen}>
      <summary className="fold-head">
        <h2>{title}</h2>
        {label}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  )
}
