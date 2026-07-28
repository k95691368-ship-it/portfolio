import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { describeDeadline } from '../lib/deadline.js'

export default function JobsPage() {
  const [postings, setPostings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get('/jobs')
      .then((data) => setPostings(data.postings))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="jobs-page">
      <header className="page-header">
        <Link to="/" className="back-link">
          ← 처음으로
        </Link>
        <h1>채용 공고</h1>
        <p>
          관심 있는 공고에 로그인 없이 바로 지원할 수 있습니다. ·{' '}
          <Link to="/application-status">지원 현황 조회 →</Link>
        </p>
      </header>

      {error && <p className="error">{error}</p>}
      {loading ? (
        <p>불러오는 중...</p>
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
    </div>
  )
}
