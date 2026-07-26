import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'

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
          {postings.map((posting) => (
            <li key={posting.id}>
              <Link to={`/jobs/${posting.id}`} className="job-card">
                <span className="job-card-title">{posting.title}</span>
                <span className="job-card-meta">
                  {[posting.department, posting.employmentType, posting.location]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {posting.deadline && (
                  <span className="job-card-deadline">~ {posting.deadline} 마감</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
