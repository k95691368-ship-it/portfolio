import { useEffect, useState } from 'react'
import RoomEnterForm from '../components/RoomEnterForm.jsx'
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
          관심 있는 공고에 로그인 없이 바로 지원할 수 있습니다.
        </p>
        {/* 문장 안에 두었더니 좁은 화면에서 "지 / 원 현황 조회" 로 낱말
            가운데가 잘렸다. 줄로 떼어 낸다. */}
        <Link to="/application-status" className="header-link">
          지원 현황 조회 →
        </Link>
      </header>

      {error && <p className="error" role="alert">{error}</p>}
      {loading ? (
        <p className="notice">불러오는 중...</p>
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

      {/* 공고 탐색이 이 화면의 첫 번째 목적이다. 초대 코드를 받은 지원자의
          면접방 입구는 목록 다음의 독립된 보조 영역으로 유지한다. */}
      <RoomEnterForm />
    </div>
  )
}
