import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'

function timeAgo(createdAt) {
  const t = new Date(`${createdAt.replace(' ', 'T')}Z`).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Math.max(0, Date.now() - t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}시간 전`
  return `${Math.floor(hours / 24)}일 전`
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const rootRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const data = await api.get('/notifications')
      setItems(data.notifications)
      setUnread(data.unreadCount)
    } catch {
      // 알림 로드 실패는 조용히 무시 (핵심 기능 아님)
    }
  }, [])

  useEffect(() => {
    load()
    // 보고 있지 않은 탭에서는 확인하지 않고, 돌아오면 바로 새로고침한다.
    const tick = () => {
      if (document.visibilityState === 'visible') load()
    }
    const timer = setInterval(tick, 60000)
    document.addEventListener('visibilitychange', tick)
    return () => {
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
    try {
      await api.post('/notifications/read', {})
      await load()
    } catch {
      // 무시
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
        aria-label={`알림 ${unread}개 안 읽음`}
        onClick={() => setOpen((v) => !v)}
      >
        🔔
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <strong>알림</strong>
            {unread > 0 && (
              <button type="button" className="btn-ghost btn-sm" onClick={markAllRead}>
                모두 읽음
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="notif-empty">알림이 없습니다.</p>
          ) : (
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
