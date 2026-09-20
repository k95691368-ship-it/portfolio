import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const lifetime = useRef(null)
  const pending = useRef(null)
  useEffect(() => {
    const scope = {}
    lifetime.current = scope
    return () => {
      if (lifetime.current === scope) lifetime.current = null
      pending.current = null
    }
  }, [])
  const submit = async (event) => {
    event.preventDefault()
    if (!lifetime.current || pending.current) return
    const ticket = { scope: lifetime.current }
    pending.current = ticket
    const current = () => lifetime.current === ticket.scope && pending.current === ticket
    setBusy(true); setError(''); setMessage('')
    try {
      const data = await api.post('/account/forgot-password', { email })
      if (!current()) return
      if (!data || Array.isArray(data) || data.ok !== true || typeof data.message !== 'string' || !data.message.trim()) {
        throw new Error('요청 접수 여부를 확인하지 못했습니다. 메일함과 스팸함을 확인한 뒤 필요하면 다시 요청해주세요.')
      }
      // The generic response does not prove account existence or delivery.
      setMessage(data.message)
    } catch (failure) {
      if (current()) setError(failure?.message || '요청 접수 여부를 확인하지 못했습니다.')
    } finally {
      if (current()) { pending.current = null; setBusy(false) }
    }
  }
  return <section className="auth-page">
    <h1>비밀번호 재설정</h1>
    <p>가입한 이메일로 재설정 링크를 요청하세요. 링크는 30분 동안 한 번만 사용할 수 있습니다.</p>
    <form onSubmit={submit}>
      <label>가입 이메일<input type="email" autoComplete="email" value={email} disabled={busy} onChange={(event) => { if (!pending.current) { setEmail(event.target.value); setMessage(''); setError('') } }} required /></label>
      <button className="btn-primary btn-block" disabled={busy}>{busy ? '요청 중…' : '재설정 링크 요청'}</button>
    </form>
    {message && <p className="notice" role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <p><Link to="/login">로그인으로 돌아가기</Link></p>
  </section>
}
