import { useState } from 'react'

export default function ChatComposer({ onSend }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    try {
      await onSend(text.trim())
      setText('')
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
      <button type="submit" disabled={sending}>
        전송
      </button>
    </form>
  )
}
