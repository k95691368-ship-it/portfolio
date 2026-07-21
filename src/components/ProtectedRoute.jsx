import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function ProtectedRoute({ role, requireAdmin, allowMustChangePassword }) {
  const { user, loading } = useAuth()

  if (loading) return <p>불러오는 중...</p>
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword && !allowMustChangePassword) return <Navigate to="/change-password" replace />
  if (role && user.role !== role) return <Navigate to="/dashboard" replace />
  if (requireAdmin && !user.isAdmin) return <Navigate to="/dashboard" replace />

  return <Outlet />
}
