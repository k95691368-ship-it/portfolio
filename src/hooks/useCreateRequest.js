import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'

// Keep the submitted payload and operation ID together until the server confirms
// an outcome. This is deliberately tab-memory only; no draft data is persisted.
const DEFINITE_REJECTIONS = new Set([400, 401, 403, 404, 409, 410, 413, 415, 422, 429])

export function useCreateRequest(path) {
  const attempt = useRef({ operation: null, running: false, active: true })
  const [unconfirmed, setUnconfirmed] = useState(false)
  useEffect(() => {
    const current = attempt.current
    current.active = true
    return () => { current.active = false }
  }, [])

  const run = async (payload) => {
    const current = attempt.current
    if (current.running) return null
    current.running = true
    try {
      current.operation ||= { ...structuredClone(payload), operationId: crypto.randomUUID() }
      const result = await api.post(path, current.operation)
      if (!current.active) return null
      if (typeof result?.id !== 'string' || !result.id) {
        throw new Error('서버의 생성 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도해주세요.')
      }
      current.operation = null
      setUnconfirmed(false)
      return result
    } catch (error) {
      if (!current.active || error?.code === 'STALE_AUTH_RESPONSE') return null
      if (DEFINITE_REJECTIONS.has(error?.status)) current.operation = null
      setUnconfirmed(Boolean(current.operation))
      throw error
    } finally {
      current.running = false
    }
  }

  return { run, unconfirmed, inFlight: () => attempt.current.running }
}
