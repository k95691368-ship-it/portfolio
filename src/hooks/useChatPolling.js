import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api/client.js'

// 대화가 오갈 때는 빠르게, 조용해지면 점점 느리게 확인한다.
// 화면을 보고 있지 않을 때는 아예 확인하지 않는다.
const MAX_IDLE_MS = 15000
const BACKOFF_AFTER = 6 // 이만큼 연속으로 새 메시지가 없으면 간격을 늘린다

// initialMessages: 면접방 화면이 한 번의 요청으로 이미 받아 둔 첫 묶음.
// 이것이 올 때까지 기다렸다가 그다음부터 증분으로만 확인한다. 같은 대화를
// 두 번 받지 않기 위해서다.
export function useChatPolling(roomId, intervalMs = 2500, initialMessages = null) {
  const [messages, setMessages] = useState([])
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const lastIdRef = useRef(0)
  const fetchingRef = useRef(false)
  const emptyRunsRef = useRef(0)
  const timerRef = useRef(null)
  const seededRef = useRef(false)

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
        setMessages((prev) => [...prev, ...data.messages])
        emptyRunsRef.current = 0
      } else {
        emptyRunsRef.current += 1
      }
      setError('')
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
      // 탭이 가려져 있으면 요청하지 않고 다음 기회를 기다린다.
      if (document.visibilityState === 'visible') await poll()
      if (!stopped) schedule(nextDelay())
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
      lastIdRef.current = message.id
      // 내가 말을 걸었으니 상대 답변을 빠르게 확인한다.
      emptyRunsRef.current = 0
      setMessages((prev) => [...prev, message])
    },
    [roomId]
  )

  return { messages, error, sendMessage }
}
