import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../api/client.js'
import { roomStatusInfo } from '../lib/roomStatus.js'

const EMPTY_NEW_ACCOUNT = { email: '', displayName: '', role: 'candidate', companyName: '' }

export default function AdminPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingId, setPendingId] = useState('')
  const [revealed, setRevealed] = useState({})

  const [newAccount, setNewAccount] = useState(EMPTY_NEW_ACCOUNT)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [viewingRoom, setViewingRoom] = useState(null)
  const [roomMessages, setRoomMessages] = useState([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState('')

  const loadAll = useCallback(async () => {
    const [usersData, roomsData] = await Promise.all([api.get('/admin/users'), api.get('/admin/rooms')])
    setUsers(usersData.users)
    setRooms(roomsData.rooms)
  }, [])

  useEffect(() => {
    loadAll()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [loadAll])

  const dismissRevealed = (id) =>
    setRevealed((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })

  const updateNewAccount = (field) => (e) => setNewAccount((f) => ({ ...f, [field]: e.target.value }))

  const handleCreateAccount = async (e) => {
    e.preventDefault()
    setCreateError('')
    setCreating(true)
    try {
      const res = await api.post('/admin/users', {
        email: newAccount.email,
        displayName: newAccount.displayName,
        role: newAccount.role,
        companyName: newAccount.role === 'company' ? newAccount.companyName : undefined,
      })
      setRevealed((prev) => ({ ...prev, [res.user.id]: res.tempPassword }))
      setNewAccount(EMPTY_NEW_ACCOUNT)
      await loadAll()
    } catch (err) {
      setCreateError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const handleToggleSuspend = async (target) => {
    const action = target.isSuspended ? '정지 해제' : '정지'
    if (!window.confirm(`${target.email} 계정을 ${action}하시겠습니까?`)) return
    setError('')
    setPendingId(target.id)
    try {
      await api.patch(`/admin/users/${target.id}`, { isSuspended: !target.isSuspended })
      await loadAll()
    } catch (err) {
      setError(err.message)
    } finally {
      setPendingId('')
    }
  }

  const handleToggleRecruiter = async (target) => {
    const action = target.isRecruiter ? '채용자 등급 해제' : '채용자 등급 지정'
    if (!window.confirm(`${target.email} 계정을 ${action}하시겠습니까?`)) return
    setError('')
    setPendingId(target.id)
    try {
      await api.patch(`/admin/users/${target.id}`, { isRecruiter: !target.isRecruiter })
      await loadAll()
    } catch (err) {
      setError(err.message)
    } finally {
      setPendingId('')
    }
  }

  const handleResetPassword = async (target) => {
    if (
      !window.confirm(
        `${target.email} 계정의 비밀번호를 임시 비밀번호로 재설정하시겠습니까? 해당 계정은 즉시 로그아웃됩니다.`
      )
    )
      return
    setError('')
    setPendingId(target.id)
    try {
      const res = await api.post(`/admin/users/${target.id}/reset-password`, {})
      setRevealed((prev) => ({ ...prev, [target.id]: res.tempPassword }))
    } catch (err) {
      setError(err.message)
    } finally {
      setPendingId('')
    }
  }

  const handleDelete = async (target) => {
    const typed = window.prompt(
      `이 작업은 되돌릴 수 없습니다. 삭제하려면 이메일(${target.email})을 정확히 입력하세요.`
    )
    if (typed === null) return
    if (typed !== target.email) {
      setError('입력한 이메일이 일치하지 않아 삭제를 취소했습니다.')
      return
    }
    setError('')
    setPendingId(target.id)
    try {
      await api.delete(`/admin/users/${target.id}`)
      dismissRevealed(target.id)
      await loadAll()
    } catch (err) {
      setError(err.message)
    } finally {
      setPendingId('')
    }
  }

  const handleViewMessages = async (room) => {
    setViewingRoom(room)
    setRoomMessages([])
    setMessagesError('')
    setMessagesLoading(true)
    try {
      const data = await api.get(`/admin/rooms/${room.id}/messages`)
      setRoomMessages(data.messages)
    } catch (err) {
      setMessagesError(err.message)
    } finally {
      setMessagesLoading(false)
    }
  }

  if (loading) return <p>불러오는 중...</p>

  return (
    <div className="admin-page">
      <h1>관리자 패널</h1>
      {error && <p className="error">{error}</p>}

      <section className="admin-create-account">
        <h2>새 계정 만들기</h2>
        <form onSubmit={handleCreateAccount}>
          <label>
            이메일
            <input type="email" value={newAccount.email} onChange={updateNewAccount('email')} required />
          </label>
          <label>
            이름
            <input value={newAccount.displayName} onChange={updateNewAccount('displayName')} required />
          </label>
          <label>
            역할
            <select value={newAccount.role} onChange={updateNewAccount('role')}>
              <option value="candidate">구직자</option>
              <option value="company">회사</option>
            </select>
          </label>
          {newAccount.role === 'company' && (
            <label>
              회사명
              <input value={newAccount.companyName} onChange={updateNewAccount('companyName')} />
            </label>
          )}
          <button type="submit" className="btn-primary" disabled={creating}>
            {creating ? '생성 중...' : '계정 만들기'}
          </button>
        </form>
        {createError && <p className="error">{createError}</p>}
        <p className="notice">
          생성된 계정의 임시 비밀번호는 아래 사용자 목록의 해당 계정 행에 한 번만 표시됩니다.
        </p>
      </section>

      <h2>사용자 ({users.length})</h2>
      <div className="table-scroll">
      <table className="admin-table">
        <thead>
          <tr>
            <th>이메일</th>
            <th>이름</th>
            <th>회사명</th>
            <th>역할</th>
            <th>관리자</th>
            <th>채용자</th>
            <th>상태</th>
            <th>가입일</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.displayName}</td>
              <td>{u.companyName || '-'}</td>
              <td>{u.role === 'company' ? '회사' : '구직자'}</td>
              <td>{u.isAdmin ? <span className="badge badge-accent">관리자</span> : '-'}</td>
              <td>{u.isRecruiter ? <span className="badge badge-warning">채용자</span> : '-'}</td>
              <td>
                {u.isSuspended ? (
                  <span className="badge badge-danger">정지됨</span>
                ) : (
                  <span className="badge badge-success">정상</span>
                )}
                {u.mustChangePassword && <span className="badge badge-warning">임시비밀번호</span>}
              </td>
              <td>{u.createdAt}</td>
              <td>
                {u.id === user.id ? (
                  <span className="badge badge-neutral">본인 계정</span>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={pendingId === u.id}
                      onClick={() => handleToggleRecruiter(u)}
                    >
                      {u.isRecruiter ? '채용자 해제' : '채용자 지정'}
                    </button>
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={pendingId === u.id}
                      onClick={() => handleToggleSuspend(u)}
                    >
                      {u.isSuspended ? '정지 해제' : '정지'}
                    </button>
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={pendingId === u.id}
                      onClick={() => handleResetPassword(u)}
                    >
                      비밀번호 재설정
                    </button>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      disabled={pendingId === u.id}
                      onClick={() => handleDelete(u)}
                    >
                      영구 삭제
                    </button>
                  </>
                )}
                {revealed[u.id] && (
                  <div className="temp-password-banner">
                    <p>
                      임시 비밀번호: <code>{revealed[u.id]}</code>
                    </p>
                    <p>이 비밀번호는 지금만 표시되며 다시 확인할 수 없습니다. 지금 복사하세요.</p>
                    <div>
                      <button type="button" className="btn-sm" onClick={() => navigator.clipboard.writeText(revealed[u.id])}>
                        복사
                      </button>
                      <button type="button" className="btn-sm" onClick={() => dismissRevealed(u.id)}>
                        닫기
                      </button>
                    </div>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <h2>면접방 ({rooms.length})</h2>
      <div className="table-scroll">
      <table className="admin-table">
        <thead>
          <tr>
            <th>제목</th>
            <th>회사</th>
            <th>지원자</th>
            <th>상태</th>
            <th>생성일</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => {
            const status = roomStatusInfo(r.status)
            return (
              <tr key={r.id}>
                <td>{r.title}</td>
                <td>{r.companyName || '-'}</td>
                <td>{r.candidateName || '-'}</td>
                <td>
                  <span className={`badge ${status.badgeClass}`}>{status.label}</span>
                </td>
                <td>{r.createdAt}</td>
                <td>
                  <button type="button" className="btn-sm" onClick={() => handleViewMessages(r)}>
                    채팅 보기
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>

      {viewingRoom && (
        <div className="modal-overlay" onClick={() => setViewingRoom(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>{viewingRoom.title} — 채팅 내역</h3>
            {messagesLoading && <p>불러오는 중...</p>}
            {messagesError && <p className="error">{messagesError}</p>}
            {!messagesLoading && !messagesError && (
              <div className="chat-message-list">
                {roomMessages.length === 0 ? (
                  <p>대화 내역이 없습니다.</p>
                ) : (
                  roomMessages.map((m) => (
                    <div key={m.id} className="chat-message">
                      <span className="chat-sender">
                        {m.senderName} ({m.role === 'company' ? '회사' : m.role === 'candidate' ? '지원자' : '알 수 없음'})
                      </span>
                      <p>{m.body}</p>
                    </div>
                  ))
                )}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => setViewingRoom(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
