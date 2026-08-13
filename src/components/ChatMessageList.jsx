import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatKstTime } from '../lib/formatTime.js'

// 말풍선 옆에는 시:분만 둔다. 날짜까지 붙이면 줄이 길어져 대화가 밀린다.
// 대화 목록.
//
// 서버가 최근 메시지부터 보내 주므로 목록의 끝이 최신이다. 그런데 스크롤 상자는
// 맨 위에서 시작하므로, 그대로 두면 방을 열었을 때 가장 오래된 대화가 보인다.
// 열자마자 최신으로 내린다.
//
// 다만 사용자가 위로 올려 과거를 읽는 중이라면 끌어내리지 않는다. 폴링이 2.5초
// 간격으로 도는데 그때마다 화면이 아래로 튕기면 과거 대화를 읽을 수 없다.
const NEAR_BOTTOM_PX = 40

// 누가 어느 쪽에 서는가.
//
// 흔한 메신저는 "나"를 오른쪽에 두지만, 여기서는 역할로 고정한다. 회사가 왼쪽,
// 지원자가 오른쪽으로 보는 화면과 그 반대로 보는 화면이 있으면, 나중에 이
// 대화를 증거로 함께 들여다볼 때 서로 다른 것을 보게 된다. 관리자 열람 모드에서
// 그 사람은 어느 쪽도 아니라서 기준 자체가 없기도 하다.
//
// 지원자는 왼쪽, 회사는 오른쪽. 이름 옆에 역할을 적어 누가 한 말인지 대화 밖에
// 있는 사람도 알 수 있게 한다.
const ROLE_LABEL = { company: '회사', candidate: '구직자' }

// 내가 누구인지는 방이 알려 준다.
//
// 예전에는 전역 로그인 정보에서 가져왔다. 코드로 들어온 지원자는 계정 로그인이
// 없어 그 값이 비어 있었고 — 그래서 이 화면이 통째로 죽었다 — 회사 계정이 함께
// 켜져 있는 브라우저에서는 아예 다른 사람의 id 가 들어 있었다. 신원은 방마다
// 갈리므로 방에서 받은 값을 쓴다.
export default function ChatMessageList({ messages, participants, viewerId = null }) {
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

  const roleOf = (senderId) =>
    (participants ?? []).find((p) => p.id === senderId)?.role ?? null

  return (
    <div className="chat-message-wrap">
      <div className="chat-message-list" ref={boxRef}>
        {messages.map((m) => {
          const role = roleOf(m.senderId)
          const side = role === 'company' ? 'right' : 'left'
          return (
            <div
              key={m.id}
              className={`chat-row chat-row-${side}${m.senderId === viewerId ? ' mine' : ''}`}
            >
              <div className="chat-message">
                <span className="chat-sender">
                  {m.senderName}
                  {role && <span className="chat-role">{ROLE_LABEL[role] ?? role}</span>}
                </span>
                <p>{m.body}</p>
              </div>
              <time className="chat-time" dateTime={m.createdAt}>
                {formatKstTime(m.createdAt)}
              </time>
            </div>
          )
        })}
      </div>
      {hasNew && (
        <button type="button" className="chat-jump" onClick={jumpToLatest}>
          새 메시지 ↓
        </button>
      )}
    </div>
  )
}
