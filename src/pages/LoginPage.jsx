import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { loginDestination, requiresFreshDocument } from '../lib/loginDestination.js'

export default function LoginPage() {
  const { login } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // 기본은 유지. 지금까지의 동작이 그랬고, 매번 다시 로그인하게 만드는 것은
  // 이 서비스에서 하려는 일이 아니다. 공용 컴퓨터에서 쓰는 사람만 끄면 된다.
  const [remember, setRemember] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await login(email, password, remember)
      // 등록된 면접관이 받은 직접 링크에서 로그인한 경우에만 그 세션으로
      // 돌아간다. 임의의 외부 주소를 next에 넣어 로그인 뒤 넘기는 경로는
      // 만들지 않는다.
      const destination = loginDestination(location.search)
      if (requiresFreshDocument(destination)) {
        // 로그인 화면에서 이미 로드된 분석 스크립트를 통화 화면까지 살려 두지
        // 않는다. 새 문서로 들어가면 index.html의 면접 경로 차단이 적용된다.
        window.location.assign(destination)
        return
      }
      navigate(destination)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

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
        {/* 끄면 브라우저를 닫는 순간 로그아웃된다. PC방·학교 컴퓨터에서
            지원하는 사람을 위한 것이다 — 그 계정 안에는 서명한 근로계약서와
            연락처가 들어 있다. */}
        <label className="checkbox-label remember-me">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>로그인 유지</span>
        </label>
        <button type="submit" className="btn-primary btn-block" disabled={submitting}>
          로그인
        </button>
      </form>
      <p>
        계정이 없으신가요? <Link to="/signup">회원가입</Link>
      </p>
    </div>
  )
}
