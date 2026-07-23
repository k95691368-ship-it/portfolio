import { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react'

const ToastContext = createContext(null)

let idCounter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    const timer = timers.current[id]
    if (timer) {
      clearTimeout(timer)
      delete timers.current[id]
    }
  }, [])

  const show = useCallback(
    (message, type, duration) => {
      if (!message) return
      const id = ++idCounter
      setToasts((list) => [...list, { id, message: String(message), type }])
      timers.current[id] = setTimeout(() => remove(id), duration)
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
      <div className="toast-viewport" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
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
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
