import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useDm } from '../context/DmContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { api, downloadApiFile } from '../api/client.js'
import { roomStatusInfo } from '../lib/roomStatus.js'
import Modal from '../components/Modal.jsx'
import { formatKst, formatKstDate } from '../lib/formatTime.js'
import { describeAuditDetail } from '../lib/auditDetail.js'

const EMPTY_NEW_ACCOUNT = { email: '', displayName: '', role: 'candidate', companyName: '', isRecruiter: false }
const ADMIN_RESOURCES = {
  users: { path: '/admin/users', field: 'users', label: '사용자' },
  rooms: { path: '/admin/rooms', field: 'rooms', label: '면접방' },
  audit: { path: '/admin/audit-log', field: 'entries', label: '감사 로그' },
  contracts: { path: '/admin/contracts', field: 'contracts', label: '근로계약서' },
}

const AUDIT_ACTION_LABELS = {
  create_user: '계정 생성',
  suspend_user: '계정 정지',
  unsuspend_user: '정지 해제',
  grant_recruiter: '채용자 지정',
  revoke_recruiter: '채용자 해제',
  reset_password: '비밀번호 재설정',
  delete_user: '계정 삭제',
  delete_room: '면접방 삭제',
  application_pass: '서류합격',
  application_reject: '서류불합격',
  posting_create: '공고 등록',
  posting_close: '공고 마감',
  posting_reopen: '공고 재모집',
  posting_delete: '공고 삭제',
}

export default function AdminPage() {
  const { user } = useAuth()
  const { openDm } = useDm()
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [rooms, setRooms] = useState([])
  const [pendingId, setPendingId] = useState('')
  const [revealed, setRevealed] = useState({})
  const [resources, setResources] = useState(() => Object.fromEntries(
    Object.keys(ADMIN_RESOURCES).map((key) => [key, { loading: true, loaded: false, error: '' }])
  ))
  const resourceRef = useRef(resources)
  const generations = useRef({ users: 0, rooms: 0, audit: 0, contracts: 0 })
  const lifecycle = useRef({ active: false, epoch: 0 })
  const mutation = useRef(null)

  const [newAccount, setNewAccount] = useState(EMPTY_NEW_ACCOUNT)
  const creating = pendingId === 'create-account'

  const [viewingRoom, setViewingRoom] = useState(null)
  const [roomMessages, setRoomMessages] = useState([])
  const [messagesCap, setMessagesCap] = useState(null)
  const [messagesLoading, setMessagesLoading] = useState(false)
  // 지금 열려 있는 방. 늦게 도착한 응답을 버리는 기준이다.
  const openedRoomRef = useRef(null)
  const messagesGeneration = useRef(0)
  const [messagesError, setMessagesError] = useState('')

  const [auditLog, setAuditLog] = useState([])
  // 목록이 상한에 걸려 잘렸으면 제목의 개수가 전체인 것처럼 보이지 않게 알린다.
  const [contracts, setContracts] = useState([])
  // 아직 보관되지 않은 체결 계약. 이 기능을 붙이기 전에 체결된 것들이다.
  const [pendingContracts, setPendingContracts] = useState(0)
  const archiving = pendingId === 'archive-contracts'
  const [caps, setCaps] = useState({ users: null, rooms: null, contracts: null })

  const updateResource = useCallback((key, patch) => {
    resourceRef.current = { ...resourceRef.current, [key]: { ...resourceRef.current[key], ...patch } }
    setResources(resourceRef.current)
  }, [])

  const loadResource = useCallback(async (key) => {
    if (!lifecycle.current.active) return null
    const generation = ++generations.current[key]
    const epoch = lifecycle.current.epoch
    const isCurrent = () => lifecycle.current.active && lifecycle.current.epoch === epoch && generations.current[key] === generation
    updateResource(key, { loading: true, error: '' })
    try {
      const data = await api.get(ADMIN_RESOURCES[key].path)
      if (!isCurrent()) return null
      if (!Array.isArray(data?.[ADMIN_RESOURCES[key].field])) throw new Error('Invalid resource response')
      if (key === 'users') setUsers(data.users)
      else if (key === 'rooms') setRooms(data.rooms)
      else if (key === 'audit') setAuditLog(data.entries)
      else {
        setContracts(data.contracts)
        setPendingContracts(data.pendingCount || 0)
      }
      if (key !== 'audit') setCaps((previous) => ({ ...previous, [key]: data.truncated ? data.limit : null }))
      updateResource(key, { loading: false, loaded: true, error: '' })
      return true
    } catch {
      if (!isCurrent()) return null
      updateResource(key, { loading: false, error: '연결 상태를 확인한 뒤 다시 불러와주세요.' })
      return false
    }
  }, [updateResource])

  const loadAll = useCallback(async () => {
    const results = await Promise.all(Object.keys(ADMIN_RESOURCES).map(loadResource))
    return results.includes(false) ? false : results.every((result) => result === true) ? true : null
  }, [loadResource])

  useEffect(() => {
    const currentLifecycle = lifecycle.current
    const currentGenerations = generations.current
    currentLifecycle.active = true
    loadAll()
    return () => {
      currentLifecycle.active = false
      currentLifecycle.epoch += 1
      for (const key of Object.keys(ADMIN_RESOURCES)) currentGenerations[key] += 1
      openedRoomRef.current = null
      messagesGeneration.current += 1
      mutation.current = null
    }
  }, [loadAll])

  const canMutate = (key) => {
    const state = resourceRef.current[key]
    return lifecycle.current.active && !mutation.current && state.loaded && !state.loading && !state.error
  }
  const runMutation = async (key, id, action) => {
    if (!canMutate(key)) return
    const operation = { epoch: lifecycle.current.epoch }
    mutation.current = operation
    setPendingId(id)
    const isCurrent = () => lifecycle.current.active && lifecycle.current.epoch === operation.epoch && mutation.current === operation
    try {
      await action(isCurrent)
    } catch (err) {
      if (!isCurrent()) return
      const uncertain = !err?.status || err.status >= 500
      if (uncertain) updateResource(key, { error: '변경 결과를 확인하지 못했습니다. 다시 불러와 현재 상태를 확인해주세요.' })
      toast.error(uncertain
        ? '변경 결과를 확인하지 못했습니다. 목록을 다시 불러와 확인해주세요.'
        : '요청을 처리하지 못했습니다. 입력값과 현재 권한을 확인해주세요.')
    } finally {
      if (isCurrent()) {
        mutation.current = null
        setPendingId('')
      }
    }
  }
  const refreshAfterMutation = async (isCurrent) => {
    if (!isCurrent()) return
    if (await loadAll() === false && isCurrent()) {
      toast.info('변경은 완료됐지만 일부 목록을 갱신하지 못했습니다. 해당 목록의 다시 불러오기를 눌러주세요.')
    }
  }

  // 빠진 계약서를 지금 보관한다.
  const archivePending = async () => {
    await runMutation('contracts', 'archive-contracts', async (isCurrent) => {
      const res = await api.post('/admin/contracts', {})
      if (!isCurrent()) return
      // 실패한 건을 조용히 넘기지 않는다. 보존 의무가 있는 계약서가
      // 밖에 남아 있다는 뜻이라, 몇 건인지 말해야 한다.
      if (res.failed?.length > 0) {
        toast.error(`${res.stored}건 보관, ${res.failed.length}건 실패했습니다.`)
      } else {
        toast.success(`${res.stored}건을 보관했습니다.`)
      }
      await refreshAfterMutation(isCurrent)
    })
  }

  const dismissRevealed = (id) =>
    setRevealed((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })

  const updateNewAccount = (field) => (e) => setNewAccount((f) => ({ ...f, [field]: e.target.value }))
  const toggleNewAccountRecruiter = (e) =>
    setNewAccount((f) => ({ ...f, isRecruiter: e.target.checked }))

  const handleCreateAccount = async (e) => {
    e.preventDefault()
    const submitted = newAccount
    await runMutation('users', 'create-account', async (isCurrent) => {
      const res = await api.post('/admin/users', {
        email: submitted.email,
        displayName: submitted.displayName,
        role: submitted.role,
        companyName: submitted.role === 'company' ? submitted.companyName : undefined,
        isRecruiter: submitted.isRecruiter,
      })
      if (!isCurrent()) return
      // 일회성 값은 목록 조회 결과와 분리하며 현재 화면 메모리에만 둔다.
      setRevealed((prev) => ({ ...prev, [res.user.id]: { email: res.user.email, password: res.tempPassword } }))
      setNewAccount((current) => JSON.stringify(current) === JSON.stringify(submitted) ? EMPTY_NEW_ACCOUNT : current)
      toast.success('계정이 생성되었습니다. 임시 비밀번호를 확인하세요.')
      await refreshAfterMutation(isCurrent)
    })
  }

  const handleToggleSuspend = async (target) => {
    if (!canMutate('users')) return
    const action = target.isSuspended ? '정지 해제' : '정지'
    if (!window.confirm(`${target.email} 계정을 ${action}하시겠습니까?`)) return
    await runMutation('users', target.id, async (isCurrent) => {
      await api.patch(`/admin/users/${target.id}`, { isSuspended: !target.isSuspended })
      if (!isCurrent()) return
      toast.success(`계정을 ${action}했습니다.`)
      await refreshAfterMutation(isCurrent)
    })
  }

  const handleToggleRecruiter = async (target) => {
    if (!canMutate('users')) return
    const action = target.isRecruiter ? '채용자 등급 해제' : '채용자 등급 지정'
    if (!window.confirm(`${target.email} 계정을 ${action}하시겠습니까?`)) return
    await runMutation('users', target.id, async (isCurrent) => {
      await api.patch(`/admin/users/${target.id}`, { isRecruiter: !target.isRecruiter })
      if (!isCurrent()) return
      toast.success(`${action} 처리되었습니다.`)
      await refreshAfterMutation(isCurrent)
    })
  }

  const handleResetPassword = async (target) => {
    if (!canMutate('users')) return
    if (
      !window.confirm(
        `${target.email} 계정의 비밀번호를 임시 비밀번호로 재설정하시겠습니까? 해당 계정은 즉시 로그아웃됩니다.`
      )
    )
      return
    await runMutation('users', target.id, async (isCurrent) => {
      const res = await api.post(`/admin/users/${target.id}/reset-password`, {})
      if (!isCurrent()) return
      setRevealed((prev) => ({ ...prev, [target.id]: { email: target.email, password: res.tempPassword } }))
      toast.success('임시 비밀번호가 발급되었습니다. 확인하세요.')
      await refreshAfterMutation(isCurrent)
    })
  }

  const handleDelete = async (target) => {
    if (!canMutate('users')) return
    const typed = window.prompt(
      `이 작업은 되돌릴 수 없습니다. 삭제하려면 이메일(${target.email})을 정확히 입력하세요.`
    )
    if (typed === null) return
    if (typed !== target.email) {
      toast.error('입력한 이메일이 일치하지 않아 삭제를 취소했습니다.')
      return
    }
    await runMutation('users', target.id, async (isCurrent) => {
      await api.delete(`/admin/users/${target.id}`)
      if (!isCurrent()) return
      dismissRevealed(target.id)
      toast.success('계정이 삭제되었습니다.')
      await refreshAfterMutation(isCurrent)
    })
  }

  const handleDeleteRoom = async (room) => {
    if (!canMutate('rooms')) return
    if (
      !window.confirm(
        `"${room.title}" 면접방을 영구 삭제하시겠습니까? 채팅/서명/계약 조건이 모두 사라지며 되돌릴 수 없습니다.`
      )
    )
      return
    await runMutation('rooms', room.id, async (isCurrent) => {
      let acknowledged = false
      try {
        await api.delete(`/admin/rooms/${room.id}`)
      } catch (err) {
        if (!isCurrent()) return
        // 보존 확인은 삭제 요청의 409에만 적용한다. 후속 조회 오류는 재삭제하지 않는다.
        if (err.status !== 409 || !err.message?.includes('보존')) throw err
        if (!window.confirm(`${err.message}\n\n보존 의무를 확인했으며 그래도 삭제하시겠습니까? 이 사실은 감사 로그에 남습니다.`)) return
        await api.delete(`/admin/rooms/${room.id}`, { acknowledgeRetention: true })
        acknowledged = true
      }
      if (!isCurrent()) return
      toast.success(acknowledged ? '보존 의무 확인 후 면접방이 삭제되었습니다.' : '면접방이 삭제되었습니다.')
      await refreshAfterMutation(isCurrent)
    })
  }

  const handleViewMessages = async (room) => {
    if (!lifecycle.current.active) return
    setViewingRoom(room)
    setRoomMessages([])
    setMessagesCap(null)
    setMessagesError('')
    setMessagesLoading(true)
    // 방 A 를 열고 곧바로 방 B 를 열면, 늦게 도착한 A 의 응답이 B 의 대화를
    // 덮어쓴다. 관리자 화면에서 남의 면접 대화가 다른 방 제목 아래 보이는
    // 것이므로, 화면만 어긋나는 문제가 아니다.
    const requested = room.id
    const generation = ++messagesGeneration.current
    openedRoomRef.current = requested
    const isCurrent = () => lifecycle.current.active && openedRoomRef.current === requested && messagesGeneration.current === generation
    try {
      const data = await api.get(`/admin/rooms/${requested}/messages`)
      if (!isCurrent()) return
      if (!Array.isArray(data?.messages)) throw new Error('Invalid chat response')
      setRoomMessages(data.messages)
      setMessagesCap(data.truncated ? data.limit : null)
    } catch {
      if (!isCurrent()) return
      setMessagesError('채팅 내역을 불러오지 못했습니다. 다시 시도해주세요.')
    } finally {
      if (isCurrent()) setMessagesLoading(false)
    }
  }

  const closeMessages = () => {
    openedRoomRef.current = null
    messagesGeneration.current += 1
    setViewingRoom(null)
  }
  const resourceReady = (key) => resources[key].loaded && !resources[key].loading && !resources[key].error
  const resourceNotice = (key) => (
    <>
      {resources[key].loading && <p role="status">{ADMIN_RESOURCES[key].label} 불러오는 중...</p>}
      {resources[key].error && (
        <div role="alert">
          <p className="error">
            {ADMIN_RESOURCES[key].label}{key === 'rooms' ? '을' : '를'} 불러오지 못했습니다. {resources[key].error}
            {resources[key].loaded && ' 아래는 이전에 확인한 자료입니다.'}
          </p>
          <button type="button" className="btn-sm" disabled={!!pendingId || resources[key].loading} onClick={() => loadResource(key)}>
            {ADMIN_RESOURCES[key].label} 다시 불러오기
          </button>
        </div>
      )}
    </>
  )

  return (
    <div className="admin-page">
      {/* 들어올 길만 있고 나갈 길이 없었다. 대시보드와 채용 관리에는 서로
          오가는 버튼이 있는데 관리자 패널에만 없어서, 여기 들어오면 주소를
          직접 고치거나 뒤로 가기를 눌러야 했다. 같은 자리에 같은 모양으로 둔다. */}
      <header className="dashboard-header">
        <h1>관리자 패널</h1>
        <div className="header-actions">
          <Link to="/dashboard" className="btn-nav">
            대시보드
          </Link>
          {(user?.isAdmin || user?.isRecruiter) && (
            <Link to="/recruit" className="btn-nav">
              채용 관리
            </Link>
          )}
        </div>
      </header>

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
          <label className="checkbox-label">
            <input type="checkbox" checked={newAccount.isRecruiter} onChange={toggleNewAccountRecruiter} />
            채용자 등급 부여
          </label>
          <button type="submit" className="btn-primary" disabled={!!pendingId || !resourceReady('users')}>
            {creating ? '생성 중...' : '계정 만들기'}
          </button>
        </form>
        <p className="notice">
          발급된 임시 비밀번호는 아래 일회성 계정 안내에 표시됩니다. 화면을 나가면 다시 확인할 수 없습니다.
        </p>
      </section>

      {Object.keys(revealed).length > 0 && (
        <section aria-label="일회성 계정 안내">
          <h2>일회성 계정 안내</h2>
          {Object.entries(revealed).map(([id, result]) => (
            <div key={id} className="temp-password-banner">
              <p>{result.email}</p>
              <p>임시 비밀번호: <code>{result.password}</code></p>
              <p>이 값은 현재 화면에서만 확인할 수 있습니다. 필요한 곳에 전달한 뒤 닫아주세요.</p>
              <div>
                <button type="button" className="btn-sm" onClick={async () => {
                  try { await navigator.clipboard.writeText(result.password) }
                  catch { if (lifecycle.current.active) toast.error('복사하지 못했습니다. 화면에서 직접 선택해 복사해주세요.') }
                }}>복사</button>
                <button type="button" className="btn-sm" onClick={() => dismissRevealed(id)}>닫기</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <h2>사용자{resourceReady('users') ? ` (${users.length})` : ''}</h2>
      {resourceNotice('users')}
      {caps.users && (
        <p className="notice">계정이 많아 최근 {caps.users}건만 불러왔습니다.</p>
      )}
      {resources.users.loaded && <div className="table-scroll" tabIndex={0}>
      <table className="admin-table">
        <caption className="sr-only">등록된 사용자 {users.length}명의 권한과 상태</caption>
        <thead>
          <tr>
            <th scope="col">이메일</th>
            <th scope="col">이름</th>
            <th scope="col">회사명</th>
            <th scope="col">역할</th>
            <th scope="col">권한</th>
            <th scope="col">상태</th>
            <th scope="col">가입일</th>
            <th scope="col">작업</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <th scope="row" className="cell-rowhead">
                {u.email}
              </th>
              <td>
                {/* 이름을 누르면 그 사람에게 쪽지를 보낸다.
                    본인에게는 보낼 수 없으므로 그때는 그냥 이름만 적는다. */}
                {u.id === user?.id ? (
                  u.displayName
                ) : (
                  <button
                    type="button"
                    className="dm-name-btn"
                    onClick={() =>
                      openDm({
                        id: u.id,
                        displayName: u.displayName,
                        companyName: u.companyName || null,
                        role: u.role,
                      })
                    }
                    title={`${u.displayName}님에게 쪽지 보내기`}
                  >
                    {u.displayName}
                  </button>
                )}
              </td>
              <td>{u.companyName || '-'}</td>
              <td>{u.role === 'company' ? '회사' : '구직자'}</td>
              <td>
                {u.isDeveloper ? (
                  <span className="badge badge-developer">개발자</span>
                ) : u.isAdmin ? (
                  <span className="badge badge-accent">관리자</span>
                ) : u.isRecruiter ? (
                  <span className="badge badge-warning">채용자</span>
                ) : (
                  <span className="badge badge-neutral">일반</span>
                )}
              </td>
              <td>
                {u.isSuspended ? (
                  <span className="badge badge-danger">정지됨</span>
                ) : (
                  <span className="badge badge-success">정상</span>
                )}
                {u.mustChangePassword && <span className="badge badge-warning">임시비밀번호</span>}
              </td>
              <td>{formatKstDate(u.createdAt)}</td>
              <td>
                {u.id === user.id ? (
                  <span className="badge badge-neutral">본인 계정</span>
                ) : u.isDeveloper ? (
                  <span className="badge badge-neutral">개발자 보호</span>
                ) : u.isAdmin && !user.isDeveloper ? (
                  <span className="badge badge-neutral">관리자 보호</span>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={!!pendingId || !resourceReady('users')}
                      onClick={() => handleToggleRecruiter(u)}
                    >
                      {u.isRecruiter ? '채용자 해제' : '채용자 지정'}
                    </button>
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={!!pendingId || !resourceReady('users')}
                      onClick={() => handleToggleSuspend(u)}
                    >
                      {u.isSuspended ? '정지 해제' : '정지'}
                    </button>
                    <button
                      type="button"
                      className="btn-sm"
                      disabled={!!pendingId || !resourceReady('users')}
                      onClick={() => handleResetPassword(u)}
                    >
                      비밀번호 재설정
                    </button>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      disabled={!!pendingId || !resourceReady('users')}
                      onClick={() => handleDelete(u)}
                    >
                      영구 삭제
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>}

      {/* 근로계약서 영구 보관소.
          체결된 계약서는 면접방에 매달려 있었다. 방을 지우면 조건도 서명도
          증명서도 함께 사라졌는데, 근로기준법 제42조가 보존하라는 것은 방이
          아니라 계약서다. 이제 체결되는 순간 서버가 정본을 만들어 방 바깥에
          보관하고, 방이 지워져도 여기 남는다. */}
      <h2>근로계약서 저장소{resourceReady('contracts') ? ` (${contracts.length})` : ''}</h2>
      {resourceNotice('contracts')}
      <p className="section-lead">
        양측 서명이 끝나는 순간 서버가 정본을 만들어 보관합니다. 면접방을 삭제해도 이곳의
        계약서는 삭제되지 않습니다. 보존 기간은 근로관계가 끝난 날부터 3년입니다(근로기준법
        제42조, 같은 법 시행령 제22조 제2항).
      </p>
      {caps.contracts && (
        <p className="notice">계약서가 많아 최근 {caps.contracts}건만 불러왔습니다.</p>
      )}
      {pendingContracts > 0 && (
        // 이 기능을 붙이기 전에 체결된 계약은 자동 보관에 걸리지 않았다.
        // 그것도 보존 대상이므로 눌러서 마저 채운다.
        <p className="notice">
          아직 보관되지 않은 체결 계약이 {pendingContracts}건 있습니다.{' '}
          <button type="button" className="btn-sm" onClick={archivePending} disabled={!!pendingId || !resourceReady('contracts')}>
            {archiving ? '보관하는 중...' : '지금 보관하기'}
          </button>
        </p>
      )}
      {contracts.length === 0 ? (
        resourceReady('contracts') && <p className="notice">아직 보관된 근로계약서가 없습니다.</p>
      ) : (
        <div className="table-scroll" tabIndex={0}>
          <table className="admin-table">
            <caption className="sr-only">
              보관된 근로계약서 {contracts.length}건의 당사자와 보존 정보
            </caption>
            <thead>
              <tr>
                <th scope="col">근로자</th>
                <th scope="col">사업체</th>
                <th scope="col">계약 기간</th>
                <th scope="col">서명</th>
                <th scope="col">보존 기산</th>
                <th scope="col">보존 만료</th>
                <th scope="col">원본 방</th>
                <th scope="col">증명서</th>
                <th scope="col">정본</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <th scope="row">{c.employeeName || '—'}</th>
                  <td>{c.employerName || '—'}</td>
                  <td>
                    {c.contractStartDate || '—'}
                    {c.contractEndDate ? ` ~ ${c.contractEndDate}` : ' ~ 기간의 정함 없음'}
                  </td>
                  <td>
                    {/* 양쪽이 다 서명했는가. 한쪽만이면 계약이 아직 성립하지
                        않은 상태로 파일만 남아 있는 것이다. */}
                    <span className={`badge ${c.signatureCount >= 2 ? 'badge-success' : 'badge-warning'}`}>
                      {c.signatureCount >= 2 ? '양측 완료' : `${c.signatureCount}/2`}
                    </span>
                  </td>
                  <td>{c.employmentEndedAt || '재직 중'}</td>
                  <td>{c.retentionUntil || '재직 중'}</td>
                  <td>
                    {/* 방이 지워졌다는 것은 숨길 사실이 아니다. 계약서가 왜
                        방 없이 혼자 있는지 여기서 답한다. */}
                    {c.roomDeleted ? (
                      <span className="badge badge-neutral">삭제됨</span>
                    ) : (
                      <Link className="btn-sm" to={`/rooms/${c.roomId}/contract`}>
                        열기
                      </Link>
                    )}
                  </td>
                  <td>{c.certificateSerial || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={() => void downloadApiFile(`/admin/contracts/${c.id}/file`).catch((err) => toast.error(err.message))}
                    >
                      내려받기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>면접방{resourceReady('rooms') ? ` (${rooms.length})` : ''}</h2>
      {resourceNotice('rooms')}
      {caps.rooms && (
        <p className="notice">면접방이 많아 최근 {caps.rooms}건만 불러왔습니다.</p>
      )}
      {resources.rooms.loaded && <div className="table-scroll" tabIndex={0}>
      <table className="admin-table">
        <caption className="sr-only">모든 면접방 {rooms.length}개의 참여자와 진행 상태</caption>
        <thead>
          <tr>
            <th scope="col">제목</th>
            <th scope="col">회사</th>
            <th scope="col">지원자</th>
            <th scope="col">상태</th>
            <th scope="col">생성일</th>
            <th scope="col">작업</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => {
            const status = roomStatusInfo(r.status)
            return (
              <tr key={r.id}>
                <th scope="row" className="cell-rowhead">
                  {r.title}
                </th>
                <td>{r.companyName || '-'}</td>
                <td>{r.candidateName || '-'}</td>
                <td>
                  <span className={`badge ${status.badgeClass}`}>{status.label}</span>
                  {/* 보관은 status 를 덮지 않는다. 나란히 보여 주어야 잠긴
                      방이 '진행중'으로만 읽히지 않는다. */}
                  {r.archivedAt && <span className="badge badge-neutral">보관됨</span>}
                </td>
                <td>{formatKstDate(r.createdAt)}</td>
                <td>
                  <button type="button" className="btn-sm" onClick={() => handleViewMessages(r)}>
                    채팅 보기
                  </button>
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    disabled={!!pendingId || !resourceReady('rooms')}
                    onClick={() => handleDeleteRoom(r)}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>}

      <h2>감사 로그{resourceReady('audit') ? ` (최근 ${auditLog.length}건)` : ''}</h2>
      {resourceNotice('audit')}
      {resources.audit.loaded && <div className="table-scroll" tabIndex={0}>
      <table className="admin-table">
        <caption className="sr-only">
          관리자 작업 기록 최근 {auditLog.length}건 — 언제 누가 무엇을 했는지
        </caption>
        <thead>
          <tr>
            <th scope="col">시각</th>
            <th scope="col">수행자</th>
            <th scope="col">작업</th>
            <th scope="col">대상</th>
            <th scope="col">세부정보</th>
          </tr>
        </thead>
        <tbody>
          {auditLog.length === 0 ? (
            resourceReady('audit') && <tr>
              <td colSpan={5}>기록이 없습니다.</td>
            </tr>
          ) : (
            auditLog.map((entry) => (
              <tr key={entry.id}>
                <td>{formatKst(entry.createdAt)}</td>
                <td>{entry.actorEmail}</td>
                <td>{AUDIT_ACTION_LABELS[entry.action] || entry.action}</td>
                <td>{entry.targetEmail || entry.roomTitle || '-'}</td>
                <td>{describeAuditDetail(entry.detail)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>}

      {viewingRoom && (
        <Modal title={`${viewingRoom.title} 채팅 내역`} onClose={closeMessages}>
          <h3>{viewingRoom.title} — 채팅 내역</h3>
          {messagesLoading && <p>불러오는 중...</p>}
          {messagesError && (
            <div role="alert">
              <p className="error">{messagesError}</p>
              <button type="button" className="btn-sm" disabled={messagesLoading} onClick={() => handleViewMessages(viewingRoom)}>채팅 다시 불러오기</button>
            </div>
          )}
          {messagesCap && (
            <p className="notice">
              대화가 길어 최근 {messagesCap}건만 불러왔습니다. 앞부분은 표시되지 않습니다.
            </p>
          )}
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
            <button type="button" onClick={closeMessages}>
              닫기
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
