import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import LandingPage from './pages/LandingPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import './App.css'

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
const ContractPage = lazy(() => import('./pages/ContractPage.jsx'))
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'))
const RecruitPage = lazy(() => import('./pages/RecruitPage.jsx'))

const Loading = <p>불러오는 중...</p>

function App() {
  return (
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

        <Route element={<ProtectedRoute allowMustChangePassword />}>
          <Route path="/change-password" element={<ChangePasswordPage />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/rooms/:roomId" element={<RoomPage />} />
          <Route path="/rooms/:roomId/contract" element={<ContractPage />} />
        </Route>
        <Route element={<ProtectedRoute requireRecruiter />}>
          <Route path="/recruit" element={<RecruitPage />} />
        </Route>
        <Route element={<ProtectedRoute requireAdmin />}>
          <Route path="/admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default App
