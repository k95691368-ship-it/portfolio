import { useEffect, useRef, useState } from 'react'

export default function ChatComposer({ onSend }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const editVersion = useRef(0)
  const pending = useRef(null)
  const lifetime = useRef(null)

  useEffect(() => {
    const scope = {}
    lifetime.current = scope
    return () => { if (lifetime.current === scope) lifetime.current = null }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const body = text.trim()
    if (!body || pending.current || !lifetime.current) return
    const request = { version: editVersion.current, scope: lifetime.current }
    pending.current = request
    const isCurrent = () => pending.current === request && lifetime.current === request.scope
    setSending(true)
    setError('')
    try {
      await onSend(body)
      if (!isCurrent()) return
      if (editVersion.current === request.version) setText('')
    } catch (err) {
      if (isCurrent()) setError(err.message || '메시지 전송을 확인하지 못했습니다.')
    } finally {
      if (isCurrent()) setSending(false)
      if (pending.current === request) pending.current = null
    }
  }

  return (
    <form className="chat-composer" onSubmit={handleSubmit}>
      <input
        value={text}
        onChange={(e) => { editVersion.current++; setText(e.target.value) }}
        maxLength={2000}
        placeholder="메시지를 입력하세요"
        aria-label="보낼 메시지"
      />
      <button type="submit" className="btn-primary btn-sm" disabled={sending || !text.trim()}>
        {sending ? '보내는 중' : '전송'}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  )
}
