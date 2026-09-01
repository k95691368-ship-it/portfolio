import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import { useAuth } from './AuthContext.jsx'

const DmContext = createContext(null)

// 쪽지함의 상태를 한 곳에 둔다.
//
// 창을 여는 쪽(관리자 패널의 이름)과 창을 그리는 쪽(오른쪽 아래 팝업)이
// 화면 트리에서 멀리 떨어져 있다. 상태를 팝업 안에 두면 관리자 패널이 그것을
// 건드릴 방법이 없다.
export function DmProvider({ children }) {
  const { user } = useAuth()
  const [threads, setThreads] = useState([])
  const [unreadTotal, setUnreadTotal] = useState(0)
  // null 이면 창이 닫힌 것, 그 외에는 지금 열려 있는 상대.
  const [open, setOpen] = useState(null)
  const [listOpen, setListOpen] = useState(false)
  // 방금 도착한 쪽지. 오른쪽 아래에 잠깐 떴다 사라진다.
  const [alerts, setAlerts] = useState([])
  // 이미 알린 쪽지는 다시 알리지 않는다. 20초마다 목록을 다시 받는데
  // 표시가 없으면 읽지 않은 쪽지를 볼 때마다 계속 튀어나온다.
  const seen = useRef(null)

  const refresh = useCallback(async () => {
    if (!user) return
    try {
      const data = await api.get('/dm')
      setThreads(data.threads)
      setUnreadTotal(data.unreadTotal)

      // 처음 열었을 때도 알린다.
      //
      // 처음 받아 온 목록은 통째로 '이미 본 것' 으로 넘겼었다. 그러면 자리를
      // 비운 사이 온 쪽지는 배지만 남고 알림이 뜨지 않는다 -- 화면을 켜 두고
      // 있던 사람만 알림을 받는 셈이라, 정작 알려야 할 경우에 조용하다.
      //
      // 다만 몇 달 치가 한꺼번에 튀어나오면 알림이 아니라 방해이므로, 처음
      // 열 때는 최근 세 사람까지만 알린다. 나머지는 배지가 말해 준다.
      const arrived = data.threads.filter((t) => t.unread > 0 && !t.lastFromMe)
      const first = seen.current === null
      if (first) seen.current = new Set()
      const fresh = arrived.filter((t) => !seen.current.has(`${t.partner.id}:${t.lastAt}`))
      for (const t of fresh) seen.current.add(`${t.partner.id}:${t.lastAt}`)
      const show = first ? fresh.slice(0, 3) : fresh
      if (show.length > 0) {
        setAlerts((prev) => [
          ...prev,
          ...show.map((t) => ({ key: `${t.partner.id}:${t.lastAt}`, partner: t.partner })),
        ])
      }
    } catch {
      // 쪽지함을 못 읽는 것으로 화면을 막지 않는다.
    }
  }, [user])

  useEffect(() => {
    if (!user) {
      setThreads([])
      setUnreadTotal(0)
      setOpen(null)
      setListOpen(false)
      setAlerts([])
      seen.current = null
      return undefined
    }
    refresh()
    // 보고 있지 않은 탭은 두드리지 않는다. 돌아오면 그때 한 번 받는다.
    const tick = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const timer = setInterval(tick, 20000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [user, refresh])

  const dismissAlert = useCallback((key) => {
    setAlerts((prev) => prev.filter((a) => a.key !== key))
  }, [])

  const openDm = useCallback((partner) => {
    if (!partner?.id) return
    setOpen(partner)
    setListOpen(false)
    setAlerts((prev) => prev.filter((a) => a.partner.id !== partner.id))
  }, [])

  const value = {
    threads,
    unreadTotal,
    open,
    listOpen,
    alerts,
    openDm,
    closeDm: useCallback(() => setOpen(null), []),
    toggleList: useCallback(() => setListOpen((v) => !v), []),
    dismissAlert,
    refresh,
  }

  return <DmContext.Provider value={value}>{children}</DmContext.Provider>
}

// 로그인하지 않은 화면에서도 부를 수 있어야 한다. 관리자 패널만 쓰는 것이
// 아니라 앞으로 다른 화면에서도 이름을 누르게 될 것이므로, 없으면 아무것도
// 하지 않는 껍데기를 돌려준다.
const NOOP = {
  threads: [],
  unreadTotal: 0,
  open: null,
  listOpen: false,
  alerts: [],
  openDm: () => {},
  closeDm: () => {},
  toggleList: () => {},
  dismissAlert: () => {},
  refresh: () => {},
}

export function useDm() {
  return useContext(DmContext) || NOOP
}
