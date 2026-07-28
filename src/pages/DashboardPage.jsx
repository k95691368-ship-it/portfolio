import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'
import DocumentManager from '../components/DocumentManager.jsx'
import NotificationBell from '../components/NotificationBell.jsx'
import { roomStatusInfo } from '../lib/roomStatus.js'

export default function DashboardPage() {
  const { user, logout } = useAuth()
  const toast = useToast()
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)

  const [title, setTitle] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdRoom, setCreatedRoom] = useState(null)

  const loadRooms = useCallback(async () => {
    const data = await api.get(user.isAdmin ? '/admin/rooms' : '/rooms/list')
    setRooms(data.rooms)
  }, [user.isAdmin])

  useEffect(() => {
    loadRooms().finally(() => setLoading(false))
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

      {user.role === 'candidate' && <DocumentManager />}

      {createdRoom && (
        <p className="notice">
          면접방이 생성되었습니다! 초대코드: <strong>{createdRoom.inviteCode}</strong>
        </p>
      )}

      <h2>{user.isAdmin ? '모든 면접방' : '내 면접방'}</h2>
      {loading ? (
        <p>불러오는 중...</p>
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
