import { useEffect, useState } from 'react'
import RoomEnterForm from '../components/RoomEnterForm.jsx'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { describeDeadline } from '../lib/deadline.js'

export default function JobsPage() {
  const [postings, setPostings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    api
      .get('/jobs')
      .then((data) => { if (active) setPostings(data.postings) })
      .catch((err) => { if (active) setError(err.message || '공고를 불러오지 못했습니다.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reload])

  return (
    <div className="jobs-page">
      <header className="page-header">
        <Link to="/" className="back-link">
          ← 처음으로
        </Link>
        <h1>채용 공고</h1>
        <p>
          관심 있는 공고에 로그인 없이 바로 지원할 수 있습니다.
        </p>
        {/* 문장 안에 두었더니 좁은 화면에서 "지 / 원 현황 조회" 로 낱말
            가운데가 잘렸다. 줄로 떼어 낸다. */}
        <Link to="/application-status" className="header-link">
          지원 현황 조회 →
        </Link>
      </header>

      <div className="jobs-workspace">
      <section className="jobs-results" aria-label="모집 중인 공고">
      {loading ? (
        <p className="notice" role="status">불러오는 중...</p>
      ) : error ? (
        <div>
          <p className="error" role="alert">공고 목록을 불러오지 못했습니다. {error}</p>
          <button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}>공고 다시 불러오기</button>
        </div>
      ) : postings.length === 0 ? (
        <p className="notice">현재 모집 중인 공고가 없습니다.</p>
      ) : (
        <ul className="job-list">
          {postings.map((posting) => {
            // 날짜만 적어 두면 급한지 아닌지를 사람이 세어 봐야 한다.
            const deadline = describeDeadline(posting.deadline)
            return (
              <li key={posting.id}>
                <Link to={`/jobs/${posting.id}`} className="job-card">
                  <span className="job-card-title">{posting.title}</span>
                  <span className="job-card-meta">
                    {[posting.department, posting.employmentType, posting.location]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {deadline.known && (
                    <span className={`job-card-deadline${deadline.soon ? ' urgent' : ''}`}>
                      {posting.deadline} · {deadline.label}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      </section>
      {/* DOM 순서는 공고 다음 입장 안내. PC에서는 보조 영역을 오른쪽에 둔다. */}
      <aside className="jobs-entry" aria-label="면접방 입장 안내">
      <RoomEnterForm />
      </aside>
      </div>
    </div>
  )
}
