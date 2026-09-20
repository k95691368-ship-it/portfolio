import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'

export default function EmailVerificationPending({ email: initialEmail = '' }) {
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [remember, setRemember] = useState(true)
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
  const edit = (update) => {
    if (pending.current) return
    update(); setMessage(''); setError('')
  }
  const submit = async (event) => {
    event.preventDefault()
    if (!lifetime.current || pending.current) return
    const ticket = { scope: lifetime.current }
    pending.current = ticket
    const current = () => lifetime.current === ticket.scope && pending.current === ticket
    setBusy(true); setError(''); setMessage('')
    try {
      const correcting = event.nativeEvent?.submitter?.value === 'correct'
      const data = await api.post(`/account/${correcting ? 'correct-email' : 'resend-verification'}`,
        { email, password, remember, ...(correcting ? { newEmail } : {}) })
      if (!current()) return
      if (!data || Array.isArray(data) || data.ok !== true || typeof data.message !== 'string' || !data.message.trim()) {
        throw new Error('요청 접수 여부를 확인하지 못했습니다. 메일함과 스팸함을 확인한 뒤 필요하면 다시 요청해주세요.')
      }
      // Account existence, delivery and address correction remain deliberately
      // undisclosed by this response; keep its generic guidance unchanged.
      setMessage(data.message)
      setPassword('')
    } catch (failure) {
      if (current()) setError(failure?.message || '요청 접수 여부를 확인하지 못했습니다.')
    } finally {
      if (current()) { pending.current = null; setBusy(false) }
    }
  }
  return <section className="auth-page">
    <h1>이메일을 확인해주세요</h1>
    <p>받은 메일의 링크에서 가입한 비밀번호를 입력하면 가입이 완료됩니다. 링크는 1시간 동안 유효합니다.</p>
    <p>메일이 도착하지 않았거나 주소를 잘못 입력했다면 아래에서 다시 요청할 수 있습니다.</p>
    <form onSubmit={submit}>
      <label>가입한 이메일<input type="email" autoComplete="email" value={email} disabled={busy} onChange={(event) => edit(() => setEmail(event.target.value))} required /></label>
      <label>가입한 비밀번호<input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={(event) => edit(() => setPassword(event.target.value))} required /></label>
      <label className="checkbox-label remember-me"><input type="checkbox" checked={remember} disabled={busy} onChange={(event) => edit(() => setRemember(event.target.checked))} />이메일 확인 후 로그인 유지</label>
      <p>공용 기기에서는 선택하지 말고 이용 후 로그아웃해주세요.</p>
      <button className="btn-primary btn-block" type="submit" value="resend" disabled={busy}>인증 메일 다시 요청</button>
      <details>
        <summary>가입 이메일을 잘못 입력했나요?</summary>
        <p>아직 이메일을 확인하지 않은 가입만 주소를 바꿀 수 있습니다. 이미 사용 중인 계정의 이메일은 변경하지 않습니다.</p>
        <label>새 이메일<input type="email" value={newEmail} disabled={busy} onChange={(event) => edit(() => setNewEmail(event.target.value))} /></label>
        <button className="btn-secondary" type="submit" value="correct" disabled={busy || !newEmail.trim()}>주소 정정 및 인증 메일 요청</button>
      </details>
    </form>
    {message && <p className="notice" role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <p><Link to="/login">로그인</Link> · <Link to="/forgot-password">비밀번호 재설정</Link></p>
  </section>
}
