import { Suspense, lazy } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { holdsPersonalData } from './lib/analytics.js'
import { useAuth } from './context/AuthContext.jsx'
import LandingPage from './pages/LandingPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import BrandLogo from './components/BrandLogo.jsx'
import PageViewTracker from './components/PageViewTracker.jsx'
import DmDock from './components/DmDock.jsx'
import DmLink from './components/DmLink.jsx'
import DemoMenu from './components/DemoMenu.jsx'
import './App.css'
import './redesign.css'

// 첫 화면(랜딩·로그인)만 즉시 포함하고 나머지는 필요할 때 불러온다.
// 공고를 보러 온 방문자가 대시보드·면접방·관리자 화면까지 받을 이유가 없다.
const SignupPage = lazy(() => import('./pages/SignupPage.jsx'))
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage.jsx'))
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'))
const RoomPage = lazy(() => import('./pages/RoomPage.jsx'))
const JobsPage = lazy(() => import('./pages/JobsPage.jsx'))
const JobDetailPage = lazy(() => import('./pages/JobDetailPage.jsx'))
const ApplyPage = lazy(() => import('./pages/ApplyPage.jsx'))
const ApplicationStatusPage = lazy(() => import('./pages/ApplicationStatusPage.jsx'))
const VerifyCertificatePage = lazy(() => import('./pages/VerifyCertificatePage.jsx'))
const TechPage = lazy(() => import('./pages/TechPage.jsx'))
const ContractPage = lazy(() => import('./pages/ContractPage.jsx'))
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'))
const RecruitPage = lazy(() => import('./pages/RecruitPage.jsx'))

const Loading = <p>불러오는 중...</p>

function App() {
  const { pathname } = useLocation()
  const { user } = useAuth()

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
    <>
      {/* 화면이 바뀔 때마다 방문 기록을 보낸다(주소의 id 는 가린다). */}
      <PageViewTracker />
      {/* 키보드로 들어온 사람이 매번 머리말을 지나치지 않아도 되게 한다. */}
      <a href="#main" className="skip-link">
        본문으로 건너뛰기
      </a>
      {/* 어느 화면에 있든 왼쪽 위에 표지가 있다.
          면접방이나 계약서 화면에 코드로 바로 들어온 사람은 자기가 어느
          서비스에 있는지 알 방법이 없었다.

          화면 색 버튼도 여기로 들인다. 오른쪽 아래에 동그라미로 떠 있어
          맨 밑의 버튼을 가리고 있었다. */}
      <header className="app-bar">
        <BrandLogo />
        <div className="app-bar-right">
          {/* 평가자용 체험. 접어 두고 올리거나 누르면 펴진다. */}
          <DemoMenu />
          {/* 관리자만 보이는 문. 관리자 패널로 가려면 대시보드를 거쳐야 했는데,
              면접방이나 계약서 화면에서는 그 길이 아예 보이지 않았다.

              없는 사람에게는 그리지 않는다. 눌러도 막히는 버튼을 보여 주면
              "여기 뭔가 있는데 나는 못 들어간다"는 것만 알려 주는 셈이고,
              누가 관리자인지도 화면 밖으로 새어 나간다.

              첫 화면에서도 그리지 않는다. 거기는 "당신은 회사인가 지원자인가"를
              묻는 자리라, 그 물음과 상관없는 문이 함께 서 있으면 고르는 일이
              흐려진다. 관리자는 어느 화면으로든 들어간 뒤에 이 문을 만난다. */}
          {user?.isAdmin && pathname !== '/' && (
            <Link
              to="/admin"
              className="app-bar-link"
              aria-current={pathname === '/admin' ? 'page' : undefined}
            >
              관리자 패널
            </Link>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1} {...(masked ? { 'data-clarity-mask': 'true' } : {})}>
        <Suspense fallback={Loading}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />

            {/* 공개: 채용 공고 · 지원 (로그인 불필요) */}
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/:id" element={<JobDetailPage />} />
            <Route path="/jobs/:id/apply" element={<ApplyPage />} />
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
            <Route path="/rooms/:roomId" element={<RoomPage />} />
            <Route path="/rooms/:roomId/contract" element={<ContractPage />} />
            <Route element={<ProtectedRoute requireRecruiter />}>
              <Route path="/recruit" element={<RecruitPage />} />
            </Route>
            <Route element={<ProtectedRoute requireAdmin />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
          </Routes>
        </Suspense>
      </main>
      {/* 오른쪽 아래 쪽지함. 로그인하지 않았으면 스스로 아무것도 그리지 않는다. */}
      <DmDock />
    </>
  )
}

export default App
