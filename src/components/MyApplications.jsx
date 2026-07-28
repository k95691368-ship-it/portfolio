import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'

const STATUS_BADGE = {
  submitted: { label: '심사 대기', badge: 'badge-warning' },
  passed: { label: '서류합격', badge: 'badge-success' },
  rejected: { label: '불합격', badge: 'badge-neutral' },
}

// 로그인한 지원자가 자기 지원서를 모아 본다.
//
// 접수번호를 따로 들고 다니며 공개 조회 화면에서 한 건씩 확인하지 않아도 되고,
// 각 지원이 채용 절차의 어디쯤 와 있는지 한눈에 보인다. 지금 할 수 있는 일이
// 있으면(면접방 입장, 계약서 서명) 바로 그리로 이어준다.
export default function MyApplications() {
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    api
      .get('/my-applications')
      .then((d) => {
        if (alive) setApplications(d.applications)
      })
      .catch(() => {
        /* 지원 이력이 없는 사용자에게는 조용히 넘어간다 */
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  // 지원한 적이 없으면 아무것도 보여주지 않는다.
  if (loading || applications.length === 0) return null

  return (
    <section className="my-applications">
      <h2>내 지원 현황</h2>
      <div className="my-app-list">
        {applications.map((a) => {
          const info = STATUS_BADGE[a.status] || STATUS_BADGE.submitted
          return (
            <article key={a.id} className="my-app-card">
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
                    {s.at && <span className="step-at">{s.at.slice(0, 10)}</span>}
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
                  접수번호 {a.lookupCode || '—'} · 지원일 {a.createdAt?.slice(0, 10)}
                </span>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
