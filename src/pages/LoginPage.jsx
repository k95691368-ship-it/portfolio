import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { loginDestination, requiresFreshDocument } from '../lib/loginDestination.js'
import SessionRecovery from '../components/SessionRecovery.jsx'
import EmailVerificationPending from '../components/EmailVerificationPending.jsx'

export default function LoginPage() {
  const { user, loading, connectionError, login } = useAuth()
  const toast = useToast()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pendingEmail, setPendingEmail] = useState('')
  // 기본은 유지. 지금까지의 동작이 그랬고, 매번 다시 로그인하게 만드는 것은
  // 이 서비스에서 하려는 일이 아니다. 공용 컴퓨터에서 쓰는 사람만 끄면 된다.
  const [remember, setRemember] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const destination = user?.mustChangePassword ? '/change-password' : loginDestination(location.search)
  const freshDocument = requiresFreshDocument(destination)

  useEffect(() => {
    if (!loading && !connectionError && user && freshDocument) {
      // 면접 링크는 복원된 로그인과 새 로그인 모두 새 문서로 진입한다.
      // 로그인 페이지에서 로드한 스크립트를 통화 화면에 남기지 않는다.
      window.location.replace(destination)
    }
  }, [user, loading, connectionError, freshDocument, destination])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await login(email, password, remember)
    } catch (err) {
      if (err.data?.verificationRequired) { setPendingEmail(email); setPassword('') }
      else toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p role="status">로그인 상태 확인 중...</p>
  if (connectionError) return <SessionRecovery />
  if (user) {
    return freshDocument
      ? <p role="status">면접 화면으로 이동 중...</p>
      : <Navigate to={destination} replace />
  }

  if (pendingEmail) return <EmailVerificationPending email={pendingEmail} />
  return (
    <div className="auth-page">
      <h1>로그인</h1>
      <form onSubmit={handleSubmit}>
        <label>
          이메일
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {/* 미선택 시 탭 저장소와 12시간 세션을 사용한다. 브라우저의 탭 복원
            기능은 세션 저장소도 복원할 수 있어 공용 PC에서는 직접 로그아웃한다. */}
        <label className="checkbox-label remember-me">
          <input
            type="checkbox"
            aria-describedby="remember-login-hint"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>로그인 유지</span>
        </label>
        <p id="remember-login-hint" className="notice">
          선택하면 브라우저를 다시 열어도 로그인을 유지합니다. 기본 30일이며 사용 중 갱신됩니다.
          공용 기기에서는 선택하지 말고, 이용 후 반드시 로그아웃해주세요.
        </p>
        <button type="submit" className="btn-primary btn-block" disabled={submitting}>
          로그인
        </button>
      </form>
      <p>
        계정이 없으신가요? <Link to="/signup">회원가입</Link>
      </p>
      <p><Link to="/forgot-password">비밀번호를 잊으셨나요?</Link> · <Link to="/verify-email">이메일 확인</Link></p>
    </div>
  )
}
