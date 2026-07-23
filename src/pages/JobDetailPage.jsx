import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'

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
  if (error) return <p className="error">{error}</p>
  if (!posting) return null

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
        {posting.deadline && <p className="job-detail-meta">지원 마감: {posting.deadline}</p>}
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
