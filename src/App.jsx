import { Suspense, lazy, useEffect, useRef } from 'react'
import { Routes, Route, NavLink, ScrollRestoration, useLocation } from 'react-router-dom'
import { holdsPersonalData } from './lib/analytics.js'
import { useAuth } from './context/AuthContext.jsx'
import LandingPage from './pages/LandingPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import BrandLogo from './components/BrandLogo.jsx'
import PageViewTracker from './components/PageViewTracker.jsx'
import DmLink from './components/DmLink.jsx'
import DemoMenu from './components/DemoMenu.jsx'
import DeferredScrollRestoration from './components/DeferredScrollRestoration.jsx'
import './App.css'
import './redesign.css'
import './posting-tools.css'
import './workspace-layout.css'

// 첫 화면(랜딩·로그인)만 즉시 포함하고 나머지는 필요할 때 불러온다.
// 공고를 보러 온 방문자가 대시보드·면접방·관리자 화면까지 받을 이유가 없다.
const SignupPage = lazy(() => import('./pages/SignupPage.jsx'))
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage.jsx'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage.jsx'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage.jsx'))
const ApplicationManagePage = lazy(() => import('./pages/ApplicationManagePage.jsx'))
const DmDock = lazy(() => import('./components/DmDock.jsx'))
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage.jsx'))
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'))
const RoomPage = lazy(() => import('./pages/RoomPage.jsx'))
const InterviewPage = lazy(() => import('./pages/InterviewPage.jsx'))
const JobsPage = lazy(() => import('./pages/JobsPage.jsx'))
const JobDetailPage = lazy(() => import('./pages/JobDetailPage.jsx'))
const ApplyPage = lazy(() => import('./pages/ApplyPage.jsx'))
const ApplicationStatusPage = lazy(() => import('./pages/ApplicationStatusPage.jsx'))
const VerifyCertificatePage = lazy(() => import('./pages/VerifyCertificatePage.jsx'))
const TechPage = lazy(() => import('./pages/TechPage.jsx'))
const ContractPage = lazy(() => import('./pages/ContractPage.jsx'))
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'))
const RecruitPage = lazy(() => import('./pages/RecruitPage.jsx'))

const Loading = (
  <div className="route-loading" role="status">
    <span className="route-loading-indicator" aria-hidden="true" />
    <span>불러오는 중...</span>
  </div>
)

function App() {
  const { pathname, key: locationKey } = useLocation()
  const { user, sessionEpoch } = useAuth()
  const isInterview = /^\/rooms\/[^/]+\/interview\/[^/]+\/?$/.test(pathname)
  const mobileNavRef = useRef(null)
  const previousLocation = useRef(locationKey)

  useEffect(() => {
    if (previousLocation.current === locationKey) return
    previousLocation.current = locationKey
    // Close only after navigation succeeds. When a dirty form blocks navigation,
    // its cancel action can restore focus to the still-visible menu link.
    mobileNavRef.current?.removeAttribute('open')
    document.getElementById('main')?.focus({ preventScroll: true })
  }, [locationKey])

  // 개인정보가 뜨는 화면은 녹화에서 통째로 가린다.
  //
  // 클래리티는 화면을 그대로 저장하고, 기본 설정은 숫자와 이메일만 가린다.
  // 이름·오간 대화·근로계약서 조건은 그냥 넘어간다. 녹화를 멈추는 API 가 없어
  // 가리는 것이 유일한 수단이다.
  //
  // 효과 안이 아니라 그리는 자리에서 붙인다. 효과로 미루면 화면이 먼저 그려진
  // 뒤에 표시가 붙어, 그 사이가 녹화될 수 있다.
  const masked = holdsPersonalData(pathname)

  return (
    <div className={isInterview ? 'app-shell app-shell--interview' : 'app-shell'}>
      {/* 화면이 바뀔 때마다 방문 기록을 보낸다(주소의 id 는 가린다). */}
      {!isInterview && <PageViewTracker />}
      {/* 키보드로 들어온 사람이 매번 머리말을 지나치지 않아도 되게 한다. */}
      {!isInterview && (
        <a href="#main" className="skip-link">
          본문으로 건너뛰기
        </a>
      )}
      {/* PC는 왼쪽 탐색 영역, 작은 화면은 상단 메뉴로 같은 목적지를 제공한다. */}
      {!isInterview && (
        <header className="app-bar">
          <BrandLogo />
          <nav className="global-nav" aria-label="주요 메뉴">
            <NavLink to="/" end>처음으로</NavLink>
            <NavLink to="/jobs">채용 공고</NavLink>
            <NavLink to="/application-status">지원 현황</NavLink>
            <NavLink to="/verify">증명서 확인</NavLink>
            <NavLink to="/tech">기술 구현</NavLink>
            <NavLink to={user ? '/dashboard' : '/login'}>
              {user ? '대시보드' : '회사 로그인'}
            </NavLink>
            {(user?.isAdmin || user?.isRecruiter) && <NavLink to="/recruit">채용 관리</NavLink>}
            {user?.isAdmin && <NavLink to="/admin">관리자 패널</NavLink>}
          </nav>
          <div className="app-bar-right">
          {/* 평가자용 체험. 접어 두고 올리거나 누르면 펴진다. */}
          <DemoMenu />
          <details className="mobile-nav" ref={mobileNavRef}>
            <summary aria-label="메뉴">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                <path className="mobile-nav-line mobile-nav-line--top" d="M5 9h14" />
                <path className="mobile-nav-line mobile-nav-line--bottom" d="M5 15h14" />
              </svg>
            </summary>
            <nav
              aria-label="모바일 주요 메뉴"
            >
              <NavLink to="/" end>처음으로</NavLink>
              <NavLink to="/jobs">채용 공고</NavLink>
              <NavLink to="/application-status">지원 현황</NavLink>
              <NavLink to="/verify">증명서 확인</NavLink>
              <NavLink to="/tech">기술 구현</NavLink>
              <NavLink to={user ? '/dashboard' : '/login'}>
                {user ? '대시보드' : '회사 로그인'}
              </NavLink>
              {(user?.isAdmin || user?.isRecruiter) && <NavLink to="/recruit">채용 관리</NavLink>}
              {user?.isAdmin && <NavLink to="/admin">관리자 패널</NavLink>}
            </nav>
          </details>
          </div>
        </header>
      )}
      <main
        id="main"
        tabIndex={-1}
        className={isInterview ? 'interview-app-main' : undefined}
        {...(masked ? { 'data-clarity-mask': 'true' } : {})}
      >
        <Suspense fallback={Loading}>
          <Routes key={sessionEpoch}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/application-manage" element={<ApplicationManagePage />} />

            {/* 공개: 채용 공고 · 지원 (로그인 불필요) */}
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/:id" element={<JobDetailPage key={pathname} />} />
            <Route path="/jobs/:id/apply" element={<ApplyPage key={pathname} />} />
            <Route path="/application-status" element={<ApplicationStatusPage />} />
            {/* 증명서는 계약 당사자가 아닌 사람에게 제시된다. 계정을 만들어야만
                확인할 수 있다면 증명서로서 쓸모가 없다. */}
            <Route path="/verify" element={<VerifyCertificatePage />} />
            {/* 코드를 보러 온 사람에게 무엇을 어떻게 만들었는지 설명하는 화면 */}
            <Route path="/tech" element={<TechPage />} />
            {/* 알림을 눌러 들어오는 자리. 쪽지창은 화면이 아니라 오른쪽 아래에
                떠 있는 것이라, 여기서는 그 창을 열고 원래 있던 곳으로 돌린다. */}
            <Route path="/dm/:partnerId" element={<DmLink />} />

            <Route element={<ProtectedRoute allowMustChangePassword />}>
              <Route path="/change-password" element={<ChangePasswordPage />} />
            </Route>
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<DashboardPage />} />
            </Route>
            {/* 면접방과 계약서에는 계정 로그인 벽을 두지 않는다.
                코드로 들어온 지원자의 신원은 계정 쿠키가 아니라 방 전용
                쿠키에 들어 있다. 여기서 계정 로그인을 요구하면 코드로 들어와도
                곧바로 로그인 화면으로 튕기고, 임시 비밀번호를 바꾸라는 화면으로
                보내진다 — 지원자는 그 임시 비밀번호를 받은 적이 없으므로
                막다른 길이다. 누가 무엇을 할 수 있는지는 서버가 판정한다. */}
            <Route path="/rooms/:roomId" element={<RoomPage key={pathname} />} />
            <Route path="/rooms/:roomId/interview/:sessionId" element={<InterviewPage key={pathname} />} />
            <Route path="/rooms/:roomId/contract" element={<ContractPage key={pathname} />} />
            <Route element={<ProtectedRoute requireRecruiter />}>
              <Route path="/recruit" element={<RecruitPage />} />
            </Route>
            <Route element={<ProtectedRoute requireAdmin />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          {/* Wait for lazy page content before restoring its scroll position.
              The router keeps history positions and hash targets, unlike an
              unconditional scroll-to-top effect on every location change. */}
          <ScrollRestoration storageKey="portfolio-scroll-positions" />
          <DeferredScrollRestoration />
        </Suspense>
      </main>
      {!isInterview && (
        <footer className="app-legal-footer" aria-label="서비스 정책">
          <span>운영자 김현욱</span>
          <a href="/privacy/">개인정보처리방침</a>
          <a href="/terms/">이용약관</a>
          <a href="mailto:k95691368@gmail.com">문의</a>
        </footer>
      )}
      {/* 오른쪽 아래 쪽지함. 로그인하지 않았으면 스스로 아무것도 그리지 않는다. */}
      {!isInterview && user && <Suspense fallback={null}><DmDock /></Suspense>}
    </div>
  )
}

export default App
