import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'

function timeAgo(createdAt) {
  const value = createdAt.replace(' ', 'T')
  const t = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Math.max(0, Date.now() - t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}시간 전`
  return `${Math.floor(hours / 24)}일 전`
}

function isNotificationList(data) {
  return Number.isSafeInteger(data?.unreadCount) && data.unreadCount >= 0 &&
    Array.isArray(data.notifications) && data.notifications.every(item =>
      item && (typeof item.id === 'string' || Number.isSafeInteger(item.id)) &&
      typeof item.message === 'string' && typeof item.createdAt === 'string' &&
      typeof item.isRead === 'boolean' && (item.link == null || typeof item.link === 'string'))
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState('')
  const [writeError, setWriteError] = useState('')
  const [marking, setMarking] = useState(false)
  const rootRef = useRef(null)
  const lifetime = useRef(null)
  const generation = useRef(0)
  const reading = useRef(null)
  const pending = useRef(null)

  const load = useCallback(async ({ background = false, afterWrite = false } = {}) => {
    const scope = lifetime.current
    if (!scope || (pending.current && !afterWrite) || (background && reading.current?.scope === scope)) return false
    const request = ++generation.current
    const read = { scope, request }
    reading.current = read
    const isCurrent = () => lifetime.current === scope && generation.current === request
    setLoading(true)
    try {
      const data = await api.get('/notifications')
      if (!isCurrent()) return false
      if (!isNotificationList(data)) throw new Error('Invalid notification response')
      setItems(data.notifications)
      setUnread(data.unreadCount)
      setLoaded(true)
      setReadError('')
      return true
    } catch {
      if (isCurrent()) setReadError('알림을 불러오지 못했습니다. 표시된 내용은 최신 상태가 아닐 수 있습니다.')
      return false
    } finally {
      if (reading.current === read) reading.current = null
      if (isCurrent()) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const scope = {}
    lifetime.current = scope
    load()
    // 보고 있지 않은 탭에서는 확인하지 않고, 돌아오면 바로 새로고침한다.
    const tick = () => {
      if (document.visibilityState === 'visible') load({ background: true })
    }
    const timer = setInterval(tick, 60000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      if (lifetime.current === scope) lifetime.current = null
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [load])

  // 바깥 클릭 시 닫기
  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const markAllRead = async () => {
    const scope = lifetime.current
    if (!scope || pending.current) return
    pending.current = scope
    const isCurrent = () => lifetime.current === scope
    // A pre-write poll must not resurrect the previous unread snapshot.
    generation.current++
    setLoading(false)
    setMarking(true)
    setWriteError('')
    try {
      const result = await api.post('/notifications/read', {})
      if (!isCurrent()) return
      if (result?.ok !== true) throw new Error('Unconfirmed read state')
      generation.current++
      setItems(previous => previous.map(item => ({ ...item, isRead: true })))
      setUnread(0)
      await load({ afterWrite: true })
    } catch {
      if (isCurrent()) setWriteError('읽음 처리 결과를 확인하지 못했습니다. 알림을 다시 불러와 확인해 주세요.')
    } finally {
      if (isCurrent()) setMarking(false)
      if (pending.current === scope) pending.current = null
    }
  }

  const handleItemClick = (n) => {
    setOpen(false)
    if (unread > 0) markAllRead()
    if (n.link) navigate(n.link)
  }

  return (
    <div className="notif-root" ref={rootRef}>
      <button
        type="button"
        className="notif-bell"
        aria-label={readError ? '알림 조회 실패' : !loaded ? '알림 확인 중' : unread > 0 ? `알림 ${unread}개 안 읽음` : '알림 없음'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span className="notif-badge" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
        {readError && unread === 0 && <span className="notif-badge" aria-hidden="true">!</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <strong>알림</strong>
            {unread > 0 && (
              <button type="button" className="btn-ghost btn-sm" disabled={marking || loading || !!readError} onClick={markAllRead}>
                {marking ? '처리 중…' : '모두 읽음'}
              </button>
            )}
          </div>
          {(readError || writeError) && <div className="notif-feedback">
            <p role="alert">{readError || writeError}</p>
            <button type="button" className="btn-ghost btn-sm" disabled={loading || marking} onClick={async () => {
              if (await load()) setWriteError('')
            }} aria-label="알림 다시 불러오기">{loading ? '불러오는 중…' : '다시 불러오기'}</button>
          </div>}
          {!loaded && loading && <p className="notif-empty" role="status">알림을 불러오는 중…</p>}
          {loaded && !readError && items.length === 0 ? (
            <p className="notif-empty">알림이 없습니다.</p>
          ) : items.length > 0 && (
            <ul className="notif-list">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`notif-item${n.isRead ? '' : ' unread'}`}
                    onClick={() => handleItemClick(n)}
                  >
                    <span className="notif-message">{n.message}</span>
                    <span className="notif-time">{timeAgo(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
