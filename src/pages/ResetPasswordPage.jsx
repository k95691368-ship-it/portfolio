import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { readAccountLinkToken, forgetAccountLinkToken } from '../lib/accountLinkToken.js'

export default function ResetPasswordPage() {
  const [token] = useState(readAccountLinkToken)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const lifetime = useRef(null)
  const pending = useRef(null)
  const completed = useRef(false)
  useEffect(() => {
    const scope = {}
    lifetime.current = scope
    return () => { if (lifetime.current === scope) lifetime.current = null }
  }, [])
  const submit = async (event) => {
    event.preventDefault()
    if (!token || !lifetime.current || pending.current || completed.current) return
    if (password !== confirmation) { setError('새 비밀번호가 일치하지 않습니다.'); return }
    const operation = { scope: lifetime.current }
    pending.current = operation
    const isCurrent = () => lifetime.current === operation.scope && pending.current === operation
    setBusy(true); setError('')
    try {
      const result = await api.post('/account/reset-password', { token, newPassword: password })
      if (!isCurrent()) return
      if (result?.ok !== true) throw new Error('비밀번호 변경 결과를 확인하지 못했습니다. 새 비밀번호로 로그인해 확인하거나 새 재설정 링크를 요청해주세요.')
      completed.current = true
      forgetAccountLinkToken(); setPassword(''); setConfirmation(''); setDone(true)
    } catch (failure) {
      if (isCurrent()) setError(failure?.message || '비밀번호 변경 결과를 확인하지 못했습니다. 새 비밀번호로 로그인해 확인해주세요.')
    } finally {
      if (isCurrent()) setBusy(false)
      if (pending.current === operation) pending.current = null
    }
  }
  if (done) return <section className="auth-page">
    <h1>비밀번호를 변경했습니다</h1>
    <p>기존 로그인은 모두 종료되었습니다. 새 비밀번호로 로그인해주세요.</p>
    <a className="btn-primary" href="/login">로그인</a>
  </section>
  return <section className="auth-page">
    <h1>새 비밀번호 설정</h1>
    {!token ? <p className="error" role="alert">이메일의 재설정 링크를 다시 열어주세요.</p> : <form onSubmit={submit}>
      <label>새 비밀번호 (8자 이상)<input type="password" autoComplete="new-password" minLength={8} maxLength={1024} value={password} readOnly={busy} onChange={(event) => setPassword(event.target.value)} required /></label>
      <label>새 비밀번호 확인<input type="password" autoComplete="new-password" value={confirmation} readOnly={busy} onChange={(event) => setConfirmation(event.target.value)} required /></label>
      <p>변경하면 다른 기기와 면접방의 기존 로그인도 종료됩니다.</p>
      <button className="btn-primary btn-block" disabled={busy}>{busy ? '변경 중…' : '비밀번호 변경'}</button>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
    <p><Link to="/forgot-password">새 재설정 링크 요청</Link></p>
  </section>
}
