import { Link, useNavigate } from 'react-router-dom'

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="landing-page">
      <div className="landing-hero">
        <p className="landing-eyebrow">AI 채용 · 전자근로계약 플랫폼</p>
        <h1>어떤 목적으로 방문하셨나요?</h1>
        <p className="landing-sub">회사와 지원자, 각자에게 맞는 화면으로 안내해 드립니다.</p>

        <div className="landing-choices">
          <button type="button" className="btn-primary landing-choice" onClick={() => navigate('/login')}>
            <span className="landing-choice-title">회사</span>
            <span className="landing-choice-desc">채용 담당자 로그인 · 면접방 · 근로계약</span>
          </button>
          <button type="button" className="btn-primary landing-choice" onClick={() => navigate('/jobs')}>
            <span className="landing-choice-title">지원자</span>
            <span className="landing-choice-desc">채용 공고 보기 · 로그인 없이 지원하기</span>
          </button>
        </div>

        {/* 증명서를 제시받은 제3자(근로감독관·법률 상담·은행)는 회사도 지원자도
            아니다. 그 사람에게도 들어올 문이 있어야 한다. */}
        <p className="landing-verify">
          계약 증명서를 제시받으셨나요? <Link to="/verify">발급번호로 진위 확인 →</Link>
        </p>
      </div>
    </div>
  )
}
