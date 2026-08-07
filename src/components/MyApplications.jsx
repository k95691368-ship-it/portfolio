import { Link } from 'react-router-dom'
import { formatKstDate } from '../lib/formatTime.js'

const STATUS_BADGE = {
  submitted: { label: '심사 대기', badge: 'badge-warning' },
  passed: { label: '서류합격', badge: 'badge-success' },
  rejected: { label: '불합격', badge: 'badge-neutral' },
}

// 단계의 상태는 점 색깔로만 구분된다. 색을 구분하지 못하거나 화면을 읽어 주는
// 도구를 쓰는 사람에게는 아무 뜻도 전달되지 않으므로 말로도 함께 남긴다.
const STEP_STATE_TEXT = {
  done: '완료',
  current: '진행 중',
  stopped: '여기서 중단됨',
  upcoming: '예정',
}

// 로그인한 지원자가 자기 지원서를 모아 본다.
//
// 접수번호를 따로 들고 다니며 공개 조회 화면에서 한 건씩 확인하지 않아도 되고,
// 각 지원이 채용 절차의 어디쯤 와 있는지 한눈에 보인다. 지금 할 수 있는 일이
// 있으면(면접방 입장, 계약서 서명) 바로 그리로 이어준다.
// applications: 대시보드가 한 번의 요청으로 함께 받아 온 목록
export default function MyApplications({ applications = [] }) {
  // 지원한 적이 없으면 아무것도 보여주지 않는다.
  if (applications.length === 0) return null

  return (
    <section className="my-applications">
      <h2>내 지원 현황</h2>
      <div className="my-app-list">
        {applications.map((a) => {
          const info = STATUS_BADGE[a.status] || STATUS_BADGE.submitted
          return (
            <article key={a.id} className="my-app-card" aria-label={`${a.postingTitle} 지원 현황`}>
              <div className="my-app-head">
                <h3>{a.postingTitle}</h3>
                <span className={`badge ${info.badge}`}>{info.label}</span>
              </div>
              <p className="my-app-meta">
                {[a.department, a.employmentType, a.location].filter(Boolean).join(' · ') || '　'}
              </p>

              <ol className="my-app-steps">
                {a.progress.steps.map((s) => (
                  <li key={s.key} className={`step-${s.state}`}>
                    <span className="step-dot" aria-hidden="true" />
                    <span className="step-label">{s.label}</span>
                    <span className="sr-only"> — {STEP_STATE_TEXT[s.state]}</span>
                    {s.at && <span className="step-at">{formatKstDate(s.at)}</span>}
                  </li>
                ))}
              </ol>

              <p className="my-app-headline">{a.progress.headline}</p>

              <div className="my-app-actions">
                {a.progress.link && (
                  <Link to={a.progress.link} className="btn-sm">
                    {a.progress.linkLabel}
                  </Link>
                )}
                <span className="my-app-code">
                  접수번호 {a.lookupCode || '—'} · 지원일 {formatKstDate(a.createdAt)}
                </span>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
