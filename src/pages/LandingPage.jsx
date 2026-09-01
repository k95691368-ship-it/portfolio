import { Link, useNavigate } from 'react-router-dom'

// 설명 줄을 걷어내면 칸이 이름 하나만 남아 허전해진다. 그림이 그 자리를
// 대신한다 -- 글자보다 먼저 읽히고, 어느 쪽이 나인지 훑어보는 데에는 그편이
// 빠르다. 파일이 아니라 코드로 그려, 화면 색이 바뀌어도 따라온다.
function ChoiceIcon({ children }) {
  return (
    <svg
      className="landing-choice-icon"
      viewBox="0 0 32 32"
      width="44"
      height="44"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="landing-page">
      <div className="landing-hero">
        <p className="landing-eyebrow">AI 채용 · 전자근로계약</p>
        <h1>어떤 목적으로 방문하셨나요?</h1>

        <div className="landing-choices">
          {/* 둘을 위아래로 쌓으면 먼저 오는 쪽이 기본값처럼 읽힌다. 여기서
              묻는 것은 순서가 아니라 "당신은 둘 중 누구인가" 이므로, 나란히
              놓아 같은 무게로 보이게 한다.

              색으로 갈라 두지는 않는다. 파란 면 두 개가 나란히 서 있으면 둘 다
              "지금 눌러라"라고 말하고, 그러면 어느 쪽도 그렇게 읽히지 않는다. */}
          <button type="button" className="landing-choice" onClick={() => navigate('/login')}>
            <ChoiceIcon>
              <path d="M5 27h22M8 27V8l8-3 8 3v19M12 12h2m4 0h2m-8 5h2m4 0h2m-4 10v-5h2v5" />
            </ChoiceIcon>
            <span className="landing-choice-title">회사</span>
          </button>
          <button type="button" className="landing-choice" onClick={() => navigate('/jobs')}>
            <ChoiceIcon>
              <circle cx="16" cy="11" r="5" />
              <path d="M6.5 27a9.5 9.5 0 0 1 19 0" />
            </ChoiceIcon>
            <span className="landing-choice-title">지원자</span>
          </button>
        </div>

        {/* 증명서를 제시받은 제3자(근로감독관·법률 상담·은행)는 회사도 지원자도
            아니다. 그 사람에게도 들어올 문이 있어야 한다. */}
        <p className="landing-verify">
          <Link to="/verify">증명서 진위 확인 →</Link>
        </p>
      </div>

      {/* 코드를 보러 온 사람에게는 화면보다 무엇을 어떻게 만들었는지가 먼저다. */}
      <Link to="/tech" className="landing-tech-link">
        기술 구현 보러가기 →
      </Link>
    </div>
  )
}
