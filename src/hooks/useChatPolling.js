import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api/client.js'

// 대화가 오갈 때는 빠르게, 조용해지면 점점 느리게 확인한다.
// 화면을 보고 있지 않을 때는 아예 확인하지 않는다.
const MAX_IDLE_MS = 15000
const BACKOFF_AFTER = 6 // 이만큼 연속으로 새 메시지가 없으면 간격을 늘린다
// 탭이 가려져 있을 때의 확인 간격. 알림만을 위한 조회라 자주 할 이유가 없고,
// 배터리와 서버 양쪽에 부담이 된다.
const HIDDEN_IDLE_MS = 20000

// 이미 가진 것과 새로 받은 것을 id 기준으로 합친다.
//
// 내가 보낸 메시지는 응답을 받자마자 화면에 붙이고, 그 뒤 폴링이 같은 것을 다시
// 가져온다. 중복을 지우고 id 순서를 지켜야 대화 순서가 어긋나지 않는다
// (낙관적으로 붙인 내 메시지가 그보다 먼저 온 상대 메시지 앞에 놓일 수 있다).
export function mergeById(existing, incoming) {
  const seen = new Set(existing.map((m) => m.id))
  const fresh = incoming.filter((m) => !seen.has(m.id))
  if (fresh.length === 0) return existing
  return [...existing, ...fresh].sort((a, b) => a.id - b.id)
}

// initialMessages: 면접방 화면이 한 번의 요청으로 이미 받아 둔 첫 묶음.
// 이것이 올 때까지 기다렸다가 그다음부터 증분으로만 확인한다. 같은 대화를
// 두 번 받지 않기 위해서다.
// options.onIncoming: 상대가 보낸 새 메시지가 도착했을 때 부른다(알림용).
// options.pollWhenHidden: 탭이 가려져 있어도 느리게 계속 확인한다.
export function useChatPolling(roomId, intervalMs = 2500, initialMessages = null, options = {}) {
  const [messages, setMessages] = useState([])
  const [error, setError] = useState('')
  // 마지막으로 실제 새 내용을 확인한 시각. 실패가 이어질 때 "언제부터"를
  // 말할 수 있어야 화면이 멈춘 것인지 상대가 조용한 것인지 구분된다.
  const [lastSyncedAt, setLastSyncedAt] = useState(null)
  const [ready, setReady] = useState(false)
  const lastIdRef = useRef(0)
  const fetchingRef = useRef(false)
  const emptyRunsRef = useRef(0)
  const timerRef = useRef(null)
  const seededRef = useRef(false)
  // 콜백이 바뀔 때마다 폴링을 다시 걸면 타이머가 끊긴다. 최신 것만 들고 있는다.
  const optsRef = useRef(options)
  optsRef.current = options

  // 다른 면접방으로 옮기면 처음 상태로 되돌린다.
  useEffect(() => {
    seededRef.current = false
    lastIdRef.current = 0
    emptyRunsRef.current = 0
    setMessages([])
    setReady(false)
  }, [roomId])

  // 첫 묶음은 화면이 받아 온 것을 그대로 쓴다. 한 번만 받는다.
  useEffect(() => {
    if (seededRef.current || !initialMessages) return
    seededRef.current = true
    if (initialMessages.length > 0) {
      lastIdRef.current = initialMessages[initialMessages.length - 1].id
      setMessages(initialMessages)
    }
    setReady(true)
  }, [initialMessages])

  const poll = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      const data = await api.get(`/rooms/${roomId}/messages?after=${lastIdRef.current}`)
      if (data.messages.length > 0) {
        lastIdRef.current = data.messages[data.messages.length - 1].id
        // 내가 보낸 메시지는 화면에 먼저 붙여 두었으므로 다시 받아도 한 번만 남긴다.
        setMessages((prev) => mergeById(prev, data.messages))
        emptyRunsRef.current = 0
        // 상대가 보낸 것만 알린다. 내가 방금 보낸 것이 되돌아온 것까지 알리면
        // 내 말에 내가 알림을 받는다.
        const viewerId = optsRef.current.viewerId
        const fromOther = viewerId
          ? data.messages.filter((m) => m.senderId !== viewerId)
          : data.messages
        if (fromOther.length > 0) optsRef.current.onIncoming?.(fromOther)
      } else {
        emptyRunsRef.current += 1
      }
      setError('')
      setLastSyncedAt(new Date().toISOString())
    } catch (err) {
      setError(err.message)
    } finally {
      fetchingRef.current = false
    }
  }, [roomId])

  useEffect(() => {
    if (!ready) return undefined

    // 조용한 시간이 길어질수록 간격을 늘리되 상한을 둔다.
    const nextDelay = () => {
      if (emptyRunsRef.current < BACKOFF_AFTER) return intervalMs
      const grown = intervalMs * (1 + (emptyRunsRef.current - BACKOFF_AFTER + 1) * 0.5)
      return Math.min(grown, MAX_IDLE_MS)
    }

    let stopped = false
    const schedule = (delay) => {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(run, delay)
    }
    const run = async () => {
      if (stopped) return
      const visible = document.visibilityState === 'visible'
      // 탭이 가려져 있으면 원래는 아예 확인하지 않았다. 그러면 알림을 켜 둔
      // 사람도 새 메시지를 영영 모른다 -- 알림이 필요한 순간이 바로 이때다.
      // 알림을 켠 경우에만, 그리고 느린 간격으로 계속 확인한다.
      if (visible || optsRef.current.pollWhenHidden) await poll()
      if (!stopped) schedule(visible ? nextDelay() : HIDDEN_IDLE_MS)
    }

    // 다시 화면으로 돌아오면 즉시 최신 내용을 가져온다.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        emptyRunsRef.current = 0
        schedule(0)
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    // 첫 묶음은 이미 받았으므로 한 박자 뒤부터 확인한다.
    schedule(intervalMs)
    return () => {
      stopped = true
      clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [poll, intervalMs, ready])

  const sendMessage = useCallback(
    async (body) => {
      const message = await api.post(`/rooms/${roomId}/messages`, { body })
      // 수신 커서(lastIdRef)는 폴링이 실제로 받아 온 것만 반영해야 한다.
      //
      // 예전에는 여기서 커서를 내 메시지 id로 앞당겼다. 그러면 상대가 방금
      // 보낸 메시지(내 것보다 작은 id)를 아직 받지 못한 상태에서 커서가 그것을
      // 뛰어넘어, 다음 폴링이 after=내id 로 묻는다. 그 메시지는 영영 오지 않는다.
      // 면접 대화는 계약 조건의 근거가 되는 기록이라 한 줄이 사라지면 안 된다.
      emptyRunsRef.current = 0
      setMessages((prev) => mergeById(prev, [message]))
      // 보낸 결과를 그대로 돌려준다. 화면이 이 응답에 실린 신호(채용 확정으로
      // 읽히는 표현, 새로 기록된 처우 조건)를 보고 상태를 다시 불러온다.
      return message
    },
    [roomId]
  )

  return { messages, error, lastSyncedAt, sendMessage }
}
