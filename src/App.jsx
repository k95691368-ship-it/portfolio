import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage.jsx'
import SignupPage from './pages/SignupPage.jsx'
import ChangePasswordPage from './pages/ChangePasswordPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import RoomPage from './pages/RoomPage.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import './App.css'

const ContractPage = lazy(() => import('./pages/ContractPage.jsx'))
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'))

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
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
