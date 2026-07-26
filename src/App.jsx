import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import LandingPage from './pages/LandingPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import SignupPage from './pages/SignupPage.jsx'
import ChangePasswordPage from './pages/ChangePasswordPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import RoomPage from './pages/RoomPage.jsx'
import JobsPage from './pages/JobsPage.jsx'
import JobDetailPage from './pages/JobDetailPage.jsx'
import ApplyPage from './pages/ApplyPage.jsx'
import ApplicationStatusPage from './pages/ApplicationStatusPage.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import './App.css'

const ContractPage = lazy(() => import('./pages/ContractPage.jsx'))
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'))
const RecruitPage = lazy(() => import('./pages/RecruitPage.jsx'))

function App() {
  return (
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
        <Route
          path="/rooms/:roomId/contract"
          element={
            <Suspense fallback={<p>불러오는 중...</p>}>
              <ContractPage />
            </Suspense>
          }
        />
      </Route>
      <Route element={<ProtectedRoute requireRecruiter />}>
        <Route
          path="/recruit"
          element={
            <Suspense fallback={<p>불러오는 중...</p>}>
              <RecruitPage />
            </Suspense>
          }
        />
      </Route>
      <Route element={<ProtectedRoute requireAdmin />}>
        <Route
          path="/admin"
          element={
            <Suspense fallback={<p>불러오는 중...</p>}>
              <AdminPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  )
}

export default App
