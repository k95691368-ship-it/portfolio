import { useState, useEffect, useCallback, useMemo, useRef } from 'react'

import { ToastContext } from './ToastContext.jsx'

let idCounter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})
  const active = useRef(true)

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    const pending = timers.current[id]
    if (pending) {
      clearTimeout(pending.timer)
      delete timers.current[id]
    }
  }, [])

  useEffect(() => {
    active.current = true
    const pending = timers.current
    // Strict Mode replays effect setup without resetting visible notices.
    // Resume their remaining lifetime instead of leaving them on screen forever.
    for (const [id, entry] of Object.entries(pending)) {
      clearTimeout(entry.timer)
      entry.timer = setTimeout(() => remove(Number(id)), Math.max(0, entry.expiresAt - Date.now()))
    }
    return () => {
      active.current = false
      for (const entry of Object.values(pending)) clearTimeout(entry.timer)
    }
  }, [remove])

  const show = useCallback(
    (message, type, duration) => {
      if (!message || !active.current) return
      const id = ++idCounter
      setToasts((list) => [...list, { id, message: String(message), type }])
      timers.current[id] = {
        timer: setTimeout(() => remove(id), duration),
        expiresAt: Date.now() + duration,
      }
      return id
    },
    [remove]
  )

  const value = useMemo(
    () => ({
      success: (message, duration = 3500) => show(message, 'success', duration),
      error: (message, duration = 5000) => show(message, 'error', duration),
      info: (message, duration = 3500) => show(message, 'info', duration),
    }),
    [show]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* 오류는 하던 일을 멈추게 하는 내용이라 즉시 읽어 주고(assertive),
          안내는 하던 일을 끊지 않도록 순서를 기다려 읽어 준다(polite).
          한 영역에 섞으면 둘 중 하나가 잘못된 방식으로 읽힌다. */}
      <div className="toast-viewport">
        <div role="alert" aria-live="assertive" aria-atomic="false">
          {toasts
            .filter((t) => t.type === 'error')
            .map((t) => (
              <button
                key={t.id}
                type="button"
                className={`toast toast-${t.type}`}
                onClick={() => remove(t.id)}
              >
                <span className="sr-only">오류: </span>
                {t.message}
              </button>
            ))}
        </div>
        <div role="status" aria-live="polite" aria-atomic="false">
          {toasts
            .filter((t) => t.type !== 'error')
            .map((t) => (
              <button
                key={t.id}
                type="button"
                className={`toast toast-${t.type}`}
                onClick={() => remove(t.id)}
              >
                {t.message}
              </button>
            ))}
        </div>
      </div>
    </ToastContext.Provider>
  )
}
