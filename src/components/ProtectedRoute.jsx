import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function ProtectedRoute({ role }) {
  const { user, loading } = useAuth()

  if (loading) return <p>불러오는 중...</p>
  if (!user) return <Navigate to="/login" replace />
  if (role && user.role !== role) return <Navigate to="/dashboard" replace />

  return <Outlet />
}
