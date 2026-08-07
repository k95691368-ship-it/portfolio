import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

// 대화 목록.
//
// 서버가 최근 메시지부터 보내 주므로 목록의 끝이 최신이다. 그런데 스크롤 상자는
// 맨 위에서 시작하므로, 그대로 두면 방을 열었을 때 가장 오래된 대화가 보인다.
// 열자마자 최신으로 내린다.
//
// 다만 사용자가 위로 올려 과거를 읽는 중이라면 끌어내리지 않는다. 폴링이 2.5초
// 간격으로 도는데 그때마다 화면이 아래로 튕기면 과거 대화를 읽을 수 없다.
const NEAR_BOTTOM_PX = 40

export default function ChatMessageList({ messages }) {
  const { user } = useAuth()
  const boxRef = useRef(null)
  const pinnedRef = useRef(true)
  const [hasNew, setHasNew] = useState(false)

  // useEffect 가 아니라 useLayoutEffect 여야 한 프레임 깜빡이지 않는다.
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight
      setHasNew(false)
    } else {
      // 위를 읽는 중에 새 메시지가 오면 알리기만 한다.
      setHasNew(true)
    }
  }, [messages])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return undefined
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
      pinnedRef.current = atBottom
      if (atBottom) setHasNew(false)
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const jumpToLatest = () => {
    const el = boxRef.current
    if (!el) return
    pinnedRef.current = true
    el.scrollTop = el.scrollHeight
    setHasNew(false)
  }

  return (
    <div className="chat-message-wrap">
      <div className="chat-message-list" ref={boxRef}>
        {messages.map((m) => (
          <div key={m.id} className={m.senderId === user.id ? 'chat-message mine' : 'chat-message'}>
            <span className="chat-sender">{m.senderName}</span>
            <p>{m.body}</p>
          </div>
        ))}
      </div>
      {hasNew && (
        <button type="button" className="chat-jump" onClick={jumpToLatest}>
          새 메시지 ↓
        </button>
      )}
    </div>
  )
}
