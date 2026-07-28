import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'

const ROLE_LABEL = { company: '회사', candidate: '구직자' }

// 권한이 모자란 화면에 들어오면 조용히 돌려보내지 않고 이유를 팝업으로 알린다.
function denialReason(user, { role, requireAdmin, requireRecruiter }) {
  if (requireAdmin && !user.isAdmin) {
    return '권한 없음 — 관리자 계정만 접근할 수 있는 화면입니다.'
  }
  if (requireRecruiter && !user.isAdmin && !user.isRecruiter) {
    return '권한 없음 — 채용 관리 권한이 있는 계정만 접근할 수 있습니다.'
  }
  if (role && user.role !== role) {
    return `권한 없음 — ${ROLE_LABEL[role] || role} 계정만 접근할 수 있는 화면입니다.`
  }
  return null
}

export default function ProtectedRoute({
  role,
  requireAdmin,
  requireRecruiter,
  allowMustChangePassword,
}) {
  const { user, loading } = useAuth()
  const toast = useToast()

  const mustChange = !!user?.mustChangePassword && !allowMustChangePassword
  const denial =
    !loading && user && !mustChange ? denialReason(user, { role, requireAdmin, requireRecruiter }) : null

  // 알림은 렌더 중이 아니라 커밋 후에 띄운다.
  useEffect(() => {
    if (denial) toast.error(denial)
  }, [denial, toast])

  if (loading) return <p>불러오는 중...</p>
  if (!user) return <Navigate to="/login" replace />
  if (mustChange) return <Navigate to="/change-password" replace />
  if (denial) return <Navigate to="/dashboard" replace />

  return <Outlet />
}
