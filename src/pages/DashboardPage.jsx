import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import DocumentManager from '../components/DocumentManager.jsx'
import NotificationBell from '../components/NotificationBell.jsx'
import MyApplications from '../components/MyApplications.jsx'
import { roomStatusInfo } from '../lib/roomStatus.js'

export default function DashboardPage() {
  const { user, logout } = useAuth()
  const toast = useToast()
  const [rooms, setRooms] = useState([])
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [title, setTitle] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdRoom, setCreatedRoom] = useState(null)

  // 관리자는 모든 면접방을 보므로 방 목록과 지원 현황을 각각 받는다.
  // (통합 조회는 본인 참여 방만 담아 관리자에게는 쓸모가 없고, 그것까지 함께
  //  읽으면 관리자 화면마다 쓰지 않을 조회가 한 번 더 도는 셈이 된다.)
  // 그 밖에는 면접방과 지원 현황을 한 번에 받는다.
  const loadRooms = useCallback(async () => {
    if (user.isAdmin) {
      const [roomData, mine] = await Promise.all([
        api.get('/admin/rooms'),
        api.get('/my-applications'),
      ])
      setRooms(roomData.rooms)
      setApplications(mine.applications)
      return
    }
    const data = await api.get('/dashboard')
    setRooms(data.rooms)
    setApplications(data.applications)
  }, [user.isAdmin])

  // 실패를 삼키면 "참여 중인 면접방이 없습니다"가 떠서, 불러오지 못한 것과
  // 정말 없는 것을 구분할 수 없다.
  useEffect(() => {
    setLoadError('')
    loadRooms()
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false))
  }, [loadRooms])

  const handleCreate = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const room = await api.post('/rooms/create', { title })
      setCreatedRoom(room)
      setTitle('')
      await loadRooms()
      toast.success('면접방이 생성되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleJoin = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await api.post('/rooms/join', { inviteCode })
      setInviteCode('')
      await loadRooms()
      toast.success('면접방에 참여했습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <h1>{user.role === 'company' ? '회사' : '구직자'} 대시보드</h1>
        <div className="header-actions">
          <NotificationBell />
          {(user.isAdmin || user.isRecruiter) && (
            <Link to="/recruit" className="btn-nav">
              채용 관리
            </Link>
          )}
          {user.isAdmin && (
            <Link to="/admin" className="btn-nav">
              관리자 패널
            </Link>
          )}
          <button className="btn-ghost" onClick={logout}>
            로그아웃
          </button>
        </div>
      </header>
      <p>{user.displayName}님, 환영합니다.</p>

      {user.role === 'company' ? (
        <form onSubmit={handleCreate}>
          <label>
            면접방 제목
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <button type="submit" className="btn-primary" disabled={submitting}>
            면접방 만들기
          </button>
        </form>
      ) : (
        <form onSubmit={handleJoin}>
          <label>
            초대코드
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required />
          </label>
          <button type="submit" className="btn-primary" disabled={submitting}>
            참여하기
          </button>
        </form>
      )}

      <MyApplications applications={applications} />

      {user.role === 'candidate' && <DocumentManager />}

      {createdRoom && (
        <p className="notice">
          면접방이 생성되었습니다! 초대코드: <strong>{createdRoom.inviteCode}</strong>
        </p>
      )}

      <h2>{user.isAdmin ? '모든 면접방' : '내 면접방'}</h2>
      {loading ? (
        <p>불러오는 중...</p>
      ) : loadError ? (
        <p className="error" role="alert">
          목록을 불러오지 못했습니다 — {loadError}
        </p>
      ) : rooms.length === 0 ? (
        <p>{user.isAdmin ? '등록된 면접방이 없습니다.' : '참여 중인 면접방이 없습니다.'}</p>
      ) : (
        <ul className="room-list">
          {rooms.map((room) => {
            const status = roomStatusInfo(room.status)
            return (
              <li key={room.id}>
                <Link to={`/rooms/${room.id}`} className="room-link">
                  <div className="room-info">
                    <span className="room-title">{room.title}</span>
                    <span className="room-meta">
                      {user.isAdmin
                        ? `${room.companyName || '회사'}${room.candidateName ? ` · ${room.candidateName}` : ' · 지원자 대기'}`
                        : user.role === 'company'
                          ? room.candidateName
                            ? `${room.candidateName}님 참여 중`
                            : '지원자 대기 중'
                          : room.companyName}
                      {!user.isAdmin && user.role === 'company' && ` · 초대코드 ${room.inviteCode}`}
                    </span>
                    {room.nextAction && <span className="room-next-action">→ {room.nextAction}</span>}
                    {room.periodAlert && (
                      <span className="room-period-alert">⏱ {room.periodAlert}</span>
                    )}
                  </div>
                  <span className={`badge ${status.badgeClass}`}>{status.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
