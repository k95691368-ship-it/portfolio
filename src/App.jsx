import { Suspense, lazy } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import LoginPage from './pages/LoginPage.jsx'
import SignupPage from './pages/SignupPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import RoomPage from './pages/RoomPage.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import './App.css'

const ContractPage = lazy(() => import('./pages/ContractPage.jsx'))

function LandingPage() {
  return (
    <>
      <h1>포트폴리오 7월 18일 제작</h1>
      <p>
        <Link to="/login">인터뷰 플랫폼 데모 보기</Link>
      </p>
    </>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
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
    </Routes>
  )
}

export default App
