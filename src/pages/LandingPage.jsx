import { Link } from 'react-router-dom'
import DeveloperTrialEntry from '../components/DeveloperTrialEntry.jsx'

export default function LandingPage() {
  return (
    <div className="landing-page">
      <section className="landing-hero" aria-labelledby="landing-title">
        <h1 id="landing-title"><span>AI 채용.</span><span>전자근로계약.</span></h1>
        <p className="landing-eyebrow">어떤 목적으로 방문하셨나요?</p>
        <div className="landing-choices" aria-label="방문 목적 선택">
          <Link
            to="/login"
            className="landing-choice landing-choice--company"
          >
            <span>회사</span><span className="landing-choice-arrow" aria-hidden="true">→</span>
          </Link>
          <Link
            to="/jobs"
            className="landing-choice landing-choice--candidate"
          >
            <span>지원자</span><span className="landing-choice-arrow" aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
      <nav className="landing-actions" aria-label="추가 메뉴">
          <Link to="/verify">증명서 진위 확인 →</Link>
          <Link to="/tech">기술 구현 보러가기 →</Link>
      </nav>
      <DeveloperTrialEntry />
    </div>
  )
}
