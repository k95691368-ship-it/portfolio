import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../api/client.js'

export default function AdminPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingId, setPendingId] = useState('')
  const [revealed, setRevealed] = useState({})

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

  if (loading) return <p>불러오는 중...</p>

  return (
    <div className="admin-page">
      <h1>관리자 패널</h1>
      {error && <p className="error">{error}</p>}

      <h2>사용자 ({users.length})</h2>
      <table className="admin-table">
        <thead>
          <tr>
            <th>이메일</th>
            <th>이름</th>
            <th>회사명</th>
            <th>역할</th>
            <th>관리자</th>
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
              <td>{u.isAdmin ? 'O' : '-'}</td>
              <td>{u.isSuspended ? '정지됨' : '정상'}</td>
              <td>{u.createdAt}</td>
              <td>
                {u.id === user.id ? (
                  <span>본인 계정</span>
                ) : (
                  <>
                    <button type="button" disabled={pendingId === u.id} onClick={() => handleToggleSuspend(u)}>
                      {u.isSuspended ? '정지 해제' : '정지'}
                    </button>
                    <button type="button" disabled={pendingId === u.id} onClick={() => handleResetPassword(u)}>
                      비밀번호 재설정
                    </button>
                    <button type="button" disabled={pendingId === u.id} onClick={() => handleDelete(u)}>
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
                    <button type="button" onClick={() => navigator.clipboard.writeText(revealed[u.id])}>
                      복사
                    </button>
                    <button type="button" onClick={() => dismissRevealed(u.id)}>
                      닫기
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>면접방 ({rooms.length})</h2>
      <table className="admin-table">
        <thead>
          <tr>
            <th>제목</th>
            <th>회사</th>
            <th>지원자</th>
            <th>상태</th>
            <th>생성일</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.id}>
              <td>{r.title}</td>
              <td>{r.companyName || '-'}</td>
              <td>{r.candidateName || '-'}</td>
              <td>{r.status}</td>
              <td>{r.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
