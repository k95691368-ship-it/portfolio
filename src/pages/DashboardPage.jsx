import { useAuth } from '../context/AuthContext.jsx'

export default function DashboardPage() {
  const { user, logout } = useAuth()

  return (
    <div className="dashboard-page">
      <header>
        <h1>{user.role === 'company' ? '회사' : '구직자'} 대시보드</h1>
        <button onClick={logout}>로그아웃</button>
      </header>
      <p>{user.displayName}님, 환영합니다.</p>
      {user.role === 'company' ? (
        <p>면접방 생성 기능은 곧 추가됩니다.</p>
      ) : (
        <p>초대코드로 면접방에 참여하는 기능은 곧 추가됩니다.</p>
      )}
    </div>
  )
}
