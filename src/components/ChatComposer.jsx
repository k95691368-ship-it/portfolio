import { useState } from 'react'

export default function ChatComposer({ onSend }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    setError('')
    try {
      await onSend(text.trim())
      setText('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="chat-composer" onSubmit={handleSubmit}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="메시지를 입력하세요"
      />
      <button type="submit" className="btn-primary btn-sm" disabled={sending}>
        전송
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
