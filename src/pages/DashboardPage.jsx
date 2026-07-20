import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../api/client.js'

export default function DashboardPage() {
  const { user, logout } = useAuth()
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [title, setTitle] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdRoom, setCreatedRoom] = useState(null)

  const loadRooms = useCallback(async () => {
    const data = await api.get('/rooms/list')
    setRooms(data.rooms)
  }, [])

  useEffect(() => {
    loadRooms().finally(() => setLoading(false))
  }, [loadRooms])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const room = await api.post('/rooms/create', { title })
      setCreatedRoom(room)
      setTitle('')
      await loadRooms()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleJoin = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await api.post('/rooms/join', { inviteCode })
      setInviteCode('')
      await loadRooms()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="dashboard-page">
      <header>
        <h1>{user.role === 'company' ? '회사' : '구직자'} 대시보드</h1>
        <button onClick={logout}>로그아웃</button>
      </header>
      <p>{user.displayName}님, 환영합니다.</p>

      {user.role === 'company' ? (
        <form onSubmit={handleCreate}>
          <label>
            면접방 제목
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <button type="submit" disabled={submitting}>
            면접방 만들기
          </button>
        </form>
      ) : (
        <form onSubmit={handleJoin}>
          <label>
            초대코드
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required />
          </label>
          <button type="submit" disabled={submitting}>
            참여하기
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      {createdRoom && (
        <p>
          면접방이 생성되었습니다! 초대코드: <strong>{createdRoom.inviteCode}</strong>
        </p>
      )}

      <h2>내 면접방</h2>
      {loading ? (
        <p>불러오는 중...</p>
      ) : rooms.length === 0 ? (
        <p>참여 중인 면접방이 없습니다.</p>
      ) : (
        <ul>
          {rooms.map((room) => (
            <li key={room.id}>
              <Link to={`/rooms/${room.id}`}>{room.title}</Link>
              {' — '}
              {user.role === 'company'
                ? room.candidateName
                  ? `${room.candidateName}님 참여 중`
                  : '지원자 대기 중'
                : room.companyName}
              {user.role === 'company' && ` (초대코드: ${room.inviteCode})`}
              {` [${room.status}]`}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
