import { useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

// 연결 실패는 로그아웃이 아니다. 서버에서 신원을 다시 확인하기 전에는
// 로그인 폼이나 보호된 내용을 보여주지 않는다.
export default function SessionRecovery() {
  const { connectionError, refresh } = useAuth()
  const [retrying, setRetrying] = useState(false)
  const pending = useRef(false)

  const retry = async () => {
    if (pending.current) return
    pending.current = true
    setRetrying(true)
    try {
      await refresh()
    } catch {
      // AuthContext가 연결 실패와 실제 세션 만료를 구분해 표시한다.
    } finally {
      pending.current = false
      setRetrying(false)
    }
  }

  return (
    <section className="auth-page" aria-labelledby="session-recovery-title" aria-busy={retrying}>
      <h1 id="session-recovery-title">로그인 상태를 확인하지 못했습니다</h1>
      <p role="alert">{connectionError}</p>
      <button type="button" className="btn-primary" onClick={retry} disabled={retrying}>
        {retrying ? '확인 중…' : '다시 시도'}
      </button>
    </section>
  )
}
