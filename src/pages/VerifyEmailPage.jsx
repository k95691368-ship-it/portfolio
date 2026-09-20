import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import EmailVerificationPending from '../components/EmailVerificationPending.jsx'
import { readAccountLinkToken, forgetAccountLinkToken } from '../lib/accountLinkToken.js'
import { isVerifiedAccount } from '../utils/verifiedAccount.js'

export default function VerifyEmailPage() {
  const [token] = useState(readAccountLinkToken)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { verifyEmail } = useAuth()
  const navigate = useNavigate()
  const lifetime = useRef(null)
  const pending = useRef(null)
  const completed = useRef(false)
  useEffect(() => {
    const scope = { controller: new AbortController() }
    lifetime.current = scope
    return () => {
      scope.controller.abort()
      if (lifetime.current === scope) lifetime.current = null
    }
  }, [])
  if (!token) return <EmailVerificationPending />
  const submit = async (event) => {
    event.preventDefault()
    if (!lifetime.current || pending.current || completed.current) return
    const operation = { scope: lifetime.current }
    pending.current = operation
    const isCurrent = () => lifetime.current === operation.scope && pending.current === operation
    setBusy(true); setError('')
    try {
      // Complete this page before publishing the authenticated account remounts
      // the route tree. The context checks isCurrent before invoking this callback.
      await verifyEmail(token, password, {
        isCurrent,
        signal: operation.scope.controller.signal,
        onVerified: (user) => {
          if (!isCurrent()) return
          if (!isVerifiedAccount(user)) {
            throw new Error('이메일 확인 결과를 확인하지 못했습니다. 인증 링크를 보관하고 로그인 상태를 다시 확인해주세요.')
          }
          completed.current = true
          forgetAccountLinkToken()
          setPassword('')
          navigate(user.mustChangePassword ? '/change-password' : '/dashboard', { replace: true })
        },
      })
      if (isCurrent() && !completed.current) throw new Error('이메일 확인 결과를 확인하지 못했습니다. 인증 링크를 보관하고 로그인 상태를 다시 확인해주세요.')
    } catch (failure) {
      if (isCurrent()) setError(failure?.message || '이메일 확인 결과를 확인하지 못했습니다. 잠시 후 다시 확인해주세요.')
    } finally {
      if (isCurrent()) setBusy(false)
      if (pending.current === operation) pending.current = null
    }
  }
  return <section className="auth-page">
    <h1>가입 이메일 확인</h1>
    <p>가입할 때 정한 비밀번호를 입력하면 이메일 확인이 완료됩니다. 본인이 가입하지 않았다면 진행하지 마세요.</p>
    <form onSubmit={submit}>
      <label>가입한 비밀번호<input type="password" autoComplete="current-password" value={password} readOnly={busy} onChange={(event) => setPassword(event.target.value)} required /></label>
      <button className="btn-primary btn-block" disabled={busy}>{busy ? '확인 중…' : '이메일 확인하고 시작하기'}</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    <p><Link to="/verify-email" onClick={() => { forgetAccountLinkToken(); window.location.replace('/verify-email') }}>새 인증 메일 요청</Link> · <Link to="/forgot-password">비밀번호 재설정</Link></p>
  </section>
}
