import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { describeDeadline } from '../lib/deadline.js'

export default function JobDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [posting, setPosting] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get(`/jobs/${id}`)
      .then((data) => setPosting(data.posting))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <p>불러오는 중...</p>

  // 마감된 공고 링크를 받아 들어오는 경우가 흔하다. 오류만 덩그러니 남기면
  // 돌아갈 길이 없으므로, 다른 공고를 볼 수 있게 이어 준다.
  if (error) {
    return (
      <div className="job-detail-page">
        <header className="page-header">
          <Link to="/jobs" className="back-link">
            ← 채용 공고 목록
          </Link>
        </header>
        <p className="error" role="alert">
          {error}
        </p>
        <p>
          <Link to="/jobs">모집 중인 다른 공고 보기 →</Link>
        </p>
      </div>
    )
  }
  if (!posting) return null

  const deadline = describeDeadline(posting.deadline)

  return (
    <div className="job-detail-page">
      <header className="page-header">
        <Link to="/jobs" className="back-link">
          ← 채용 공고 목록
        </Link>
        <h1>{posting.title}</h1>
        <p className="job-detail-meta">
          {[posting.department, posting.employmentType, posting.location].filter(Boolean).join(' · ')}
        </p>
        {deadline.known && (
          <p className={`job-detail-meta${deadline.soon ? ' deadline-urgent' : ''}`}>
            지원 마감: {posting.deadline} · {deadline.label}
          </p>
        )}
      </header>

      <div className="job-detail-body">{posting.description}</div>

      <div className="job-detail-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate(`/jobs/${id}/apply`)}
        >
          지원하기
        </button>
      </div>
    </div>
  )
}
