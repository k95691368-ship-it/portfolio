import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api/client.js'

export function useChatPolling(roomId, intervalMs = 2500) {
  const [messages, setMessages] = useState([])
  const [error, setError] = useState('')
  const lastIdRef = useRef(0)

  const poll = useCallback(async () => {
    try {
      const data = await api.get(`/rooms/${roomId}/messages?after=${lastIdRef.current}`)
      if (data.messages.length > 0) {
        lastIdRef.current = data.messages[data.messages.length - 1].id
        setMessages((prev) => [...prev, ...data.messages])
      }
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [roomId])

  useEffect(() => {
    setMessages([])
    lastIdRef.current = 0
    poll()
    const timer = setInterval(poll, intervalMs)
    return () => clearInterval(timer)
  }, [poll, intervalMs])

  const sendMessage = useCallback(
    async (body) => {
      const message = await api.post(`/rooms/${roomId}/messages`, { body })
      lastIdRef.current = message.id
      setMessages((prev) => [...prev, message])
    },
    [roomId]
  )

  return { messages, error, sendMessage }
}
