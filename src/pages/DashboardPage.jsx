import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { api, markRoomDoor } from '../api/client.js'
import DocumentManager from '../components/DocumentManager.jsx'
import NotificationBell from '../components/NotificationBell.jsx'
import MyApplications from '../components/MyApplications.jsx'
import { roomStatusInfo } from '../lib/roomStatus.js'
import { useCreateRequest } from '../hooks/useCreateRequest.js'
import UnsavedChangesGuard from '../components/UnsavedChangesGuard.jsx'

export default function DashboardPage() {
  const { user, logout } = useAuth()
  const toast = useToast()
  const [rooms, setRooms] = useState([])
  const [applications, setApplications] = useState([])
  // 목록에 상한이 있다. 잘렸으면 잘렸다고 말한다 — 말하지 않으면 화면이
  // "이게 전부"라고 주장하는 것이 된다.
  const [truncated, setTruncated] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [applicationsError, setApplicationsError] = useState('')
  const loadGeneration = useRef(0)

  const [title, setTitle] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [createdRoom, setCreatedRoom] = useState(null)
  const createRequest = useCreateRequest('/rooms/create')

  const handleLogout = async () => {
    try {
      await logout()
    } catch (error) {
      if (error?.code === 'STALE_AUTH_RESPONSE') return
      toast.error(error?.code === 'SESSION_STORAGE_CLEAR_FAILED'
        ? '브라우저에 저장된 로그인 정보를 지우지 못했습니다. 이 사이트의 데이터를 삭제해주세요.'
        : '이 브라우저에서는 로그아웃했습니다. 서버의 세션 종료 여부는 확인하지 못했습니다.')
    }
  }

  // 관리자는 모든 면접방을 보므로 방 목록과 지원 현황을 각각 받는다.
  // (통합 조회는 본인 참여 방만 담아 관리자에게는 쓸모가 없고, 그것까지 함께
  //  읽으면 관리자 화면마다 쓰지 않을 조회가 한 번 더 도는 셈이 된다.)
  // 그 밖에는 면접방과 지원 현황을 한 번에 받는다.
  const loadRooms = useCallback(async () => {
    const generation = ++loadGeneration.current
    setLoading(true)
    setLoadError('')
    setApplicationsError('')
    try {
      if (user.isAdmin) {
        // 서로 독립된 목록이다. 한쪽 실패가 다른 쪽의 성공까지 지우지 않는다.
        const [roomResult, applicationResult] = await Promise.allSettled([
          api.get('/admin/rooms'),
          api.get('/my-applications'),
        ])
        if (generation !== loadGeneration.current) return null
        if (roomResult.status === 'fulfilled') setRooms(roomResult.value.rooms)
        else setLoadError(roomResult.reason?.message || '연결 상태를 확인해주세요.')
        if (applicationResult.status === 'fulfilled') setApplications(applicationResult.value.applications)
        else setApplicationsError(applicationResult.reason?.message || '연결 상태를 확인해주세요.')
        // 실패한 목록은 마지막으로 확인한 데이터와 잘림 표시를 함께 유지한다.
        setTruncated((previous) => ({
          rooms: roomResult.status === 'fulfilled'
            ? (roomResult.value.truncated ? roomResult.value.limit : null)
            : previous?.rooms ?? null,
          applications: applicationResult.status === 'fulfilled'
            ? (applicationResult.value.truncated ? applicationResult.value.limit : null)
            : previous?.applications ?? null,
        }))
        return roomResult.status === 'fulfilled' && applicationResult.status === 'fulfilled'
      }
      const data = await api.get('/dashboard')
      if (generation !== loadGeneration.current) return null
      setRooms(data.rooms)
      setApplications(data.applications)
      setTruncated(
        data.roomsTruncated || data.applicationsTruncated
          ? {
              rooms: data.roomsTruncated ? data.roomLimit : null,
              applications: data.applicationsTruncated ? data.applicationLimit : null,
            }
          : null
      )
      return true
    } catch (err) {
      if (generation !== loadGeneration.current) return null
      const message = err?.message || '연결 상태를 확인해주세요.'
      setLoadError(message)
      setApplicationsError(message)
      return false
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }, [user.isAdmin])

  // 실패를 삼키면 "참여 중인 면접방이 없습니다"가 떠서, 불러오지 못한 것과
  // 정말 없는 것을 구분할 수 없다.
  useEffect(() => {
    loadRooms()
    return () => { loadGeneration.current += 1 }
  }, [loadRooms])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (submitting || createRequest.inFlight()) return
    setSubmitting(true)
    try {
      const room = await createRequest.run({ title })
      if (!room) return
      setCreatedRoom(room)
      setTitle('')
      toast.success('면접방이 생성되었습니다.')
      if (await loadRooms() === false) {
        toast.info('면접방 생성은 완료됐지만 목록을 갱신하지 못했습니다. 목록 다시 불러오기를 눌러주세요.')
      }
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
      toast.success('면접방에 참여했습니다.')
      if (await loadRooms() === false) {
        toast.info('면접방 참여는 완료됐지만 목록을 갱신하지 못했습니다. 목록 다시 불러오기를 눌러주세요.')
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="dashboard-page">
      <UnsavedChangesGuard when={createRequest.unconfirmed || (user.role === 'company' && submitting)} message="면접방 생성 결과가 아직 확인되지 않았습니다. 이 화면에서 같은 요청으로 다시 시도해 결과를 확인해주세요. 지금 이동하면 재시도 정보가 사라집니다." />
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
          <button className="btn-ghost" onClick={handleLogout}>
            로그아웃
          </button>
        </div>
      </header>
      <p>{user.displayName}님, 환영합니다.</p>
      {(loadError || applicationsError) && (
        <button type="button" className="btn-sm" disabled={loading || submitting} onClick={loadRooms}>
          목록 다시 불러오기
        </button>
      )}

      <div className="dashboard-workspace">
      <aside className="dashboard-tools" aria-label={user.role === 'company' ? '면접방 생성' : '면접방 참여'}>
      {user.role === 'company' ? (
        <form onSubmit={handleCreate}>
          <label>
            면접방 제목
            <input value={title} onChange={(e) => setTitle(e.target.value)} required disabled={submitting || createRequest.unconfirmed} />
          </label>
          <button type="submit" className="btn-primary" disabled={submitting || loading || createRequest.unconfirmed}>
            면접방 만들기
          </button>
          {createRequest.unconfirmed && (
            <div className="notice" role="alert">
              <p>면접방 생성 결과를 확인하지 못했습니다. 중복 생성을 막기 위해 같은 요청으로 다시 시도합니다. 새로고침하기 전에 결과를 확인해주세요.</p>
              <button type="button" className="btn-secondary" disabled={submitting} onClick={handleCreate}>
                {submitting ? '생성 확인 중...' : '같은 요청으로 생성 다시 시도'}
              </button>
            </div>
          )}
        </form>
      ) : (
        <form onSubmit={handleJoin}>
          <label>
            초대코드
            <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required />
          </label>
          <button type="submit" className="btn-primary" disabled={submitting || loading}>
            참여하기
          </button>
        </form>
      )}

      {createdRoom && (
        <p className="notice">
          면접방이 생성되었습니다! 초대코드: <strong>{createdRoom.inviteCode}</strong>
        </p>
      )}
      </aside>

      <section className="dashboard-rooms" aria-labelledby="dashboard-rooms-title">
      <h2 id="dashboard-rooms-title">{user.isAdmin && !truncated?.rooms && !loadError ? '모든 면접방' : user.isAdmin ? '면접방' : '내 면접방'}</h2>
      {loading ? (
        <p role="status">면접방을 불러오는 중...</p>
      ) : (
        <>
        {loadError && (
          <p className="error" role="alert">
            면접방 목록을 불러오지 못했습니다 — {loadError}
            {rooms.length > 0 && ' 아래는 이전에 불러온 목록입니다.'}
          </p>
        )}
        {rooms.length === 0 && !loadError && (
          <p>{user.isAdmin ? '등록된 면접방이 없습니다.' : '참여 중인 면접방이 없습니다.'}</p>
        )}
        {rooms.length > 0 && <>
        {truncated?.rooms && (
          <p className="notice">
            면접방이 많아 최근 {truncated.rooms}개만 표시했습니다.
          </p>
        )}
        <ul className="room-list">
          {rooms.map((room) => {
            const status = roomStatusInfo(room.status)
            return (
              <li key={room.id}>
                <Link
                  to={`/rooms/${room.id}`}
                  className="room-link"
                  onClick={() => markRoomDoor(room.id, 'account')}
                >
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
                    {room.archivedAt && (
                      <span className="room-next-action">보관됨 — 대화·계약서 잠김</span>
                    )}
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
        </>}
        </>
      )}
      </section>
      </div>

      {loading ? <p role="status">지원 현황을 불러오는 중...</p> : <>
        {applicationsError && (
          <p className="error" role="alert">
            지원 현황을 불러오지 못했습니다 — {applicationsError}
            {applications.length > 0 && ' 아래는 이전에 불러온 지원 현황입니다.'}
          </p>
        )}
        {(!applicationsError || applications.length > 0) && <MyApplications applications={applications} />}
        {truncated?.applications && (
          <p className="notice">지원한 곳이 많아 최근 {truncated.applications}건만 표시했습니다.</p>
        )}
      </>}
      {user.role === 'candidate' && <DocumentManager />}
    </div>
  )
}
