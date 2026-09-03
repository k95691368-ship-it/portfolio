import { Link, useNavigate } from 'react-router-dom'

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="landing-page">
      <div className="landing-hero">
        <p className="landing-eyebrow">AI 채용 · 전자근로계약</p>
        <h1>어떤 목적으로 방문하셨나요?</h1>
        <div className="landing-choices" aria-label="방문 목적 선택">
          <button
            type="button"
            className="landing-choice landing-choice--company"
            onClick={() => navigate('/login')}
          >
            회사
          </button>
          <button
            type="button"
            className="landing-choice landing-choice--candidate"
            onClick={() => navigate('/jobs')}
          >
            지원자
          </button>
        </div>
        <div className="landing-actions">
          <Link to="/verify">증명서 진위 확인 →</Link>
          <Link to="/tech">기술 구현 보러가기 →</Link>
        </div>
      </div>
    </div>
  )
}
