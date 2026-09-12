import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function DeveloperTrialEntry() {
  const { user, startDemo } = useAuth()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const begin = async () => {
    if (user?.developerTrial) { navigate('/admin'); return }
    setStarting(true)
    setError('')
    try { await startDemo('developer'); navigate('/admin') }
    catch (err) { setError(err.message) }
    finally { setStarting(false) }
  }
  return <section className="developer-trial-entry" aria-label="개발자 권한 체험">
    <button type="button" className="btn-secondary" onClick={begin}
      disabled={starting || (!!user && !user.developerTrial)}>
      {starting ? '체험 시작 중…' : user?.developerTrial ? '체험 계속하기 →' : '개발자 권한 체험 · 1시간 →'}
    </button>
    <p className="muted">{user && !user.developerTrial ? '로그아웃 후 체험할 수 있습니다.' :
      '운영 공고 작성과 실제 이메일 발송이 가능합니다. 개발자 계정과 비밀키는 보호됩니다.'}</p>
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}
