import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { api } from '../api/client.js'

export default function ChangePasswordPage() {
  const { user, refresh } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [changed, setChanged] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const lifetime = useRef(null)
  const pending = useRef(null)
  const completed = useRef(false)
  useEffect(() => {
    const scope = {}
    lifetime.current = scope
    return () => { if (lifetime.current === scope) lifetime.current = null }
  }, [])

  const current = (operation) => lifetime.current === operation.scope && pending.current === operation
  const finishSessionCheck = async (operation) => {
    setSessionError('')
    try {
      const sessionUser = await refresh()
      if (!current(operation)) return
      if (!user?.id || sessionUser?.id !== user.id || sessionUser.mustChangePassword !== false) {
        throw new Error('Unconfirmed session')
      }
      navigate('/dashboard')
    } catch {
      if (current(operation)) setSessionError('비밀번호는 변경되었습니다. 로그인 상태 확인만 완료하지 못했습니다. 다시 확인하거나 새 비밀번호로 로그인해주세요.')
    }
  }
  const release = (operation) => {
    if (current(operation)) setSubmitting(false)
    if (pending.current === operation) pending.current = null
  }
  const retrySession = async () => {
    if (!lifetime.current || pending.current || !completed.current) return
    const operation = { scope: lifetime.current }
    pending.current = operation
    setSubmitting(true)
    try { await finishSessionCheck(operation) }
    finally { release(operation) }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!lifetime.current || pending.current || completed.current) return
    if (newPassword !== confirmPassword) {
      toast.error('새 비밀번호가 일치하지 않습니다.')
      return
    }
    const operation = { scope: lifetime.current }
    pending.current = operation
    setSubmitting(true)
    try {
      const result = await api.post('/change-password', { currentPassword, newPassword })
      if (!current(operation)) return
      if (result?.ok !== true) throw new Error('비밀번호 변경 결과를 확인하지 못했습니다. 새 비밀번호로 로그인해 확인해주세요.')
      completed.current = true
      setChanged(true)
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      toast.success('비밀번호가 변경되었습니다.')
      await finishSessionCheck(operation)
    } catch (err) {
      if (current(operation)) toast.error(err?.message || '비밀번호 변경 결과를 확인하지 못했습니다.')
    } finally {
      release(operation)
    }
  }

  if (changed) return <section className="auth-page">
    <h1>비밀번호를 변경했습니다</h1>
    {sessionError ? <p className="error" role="alert">{sessionError}</p> : <p role="status">로그인 상태를 확인하고 있습니다.</p>}
    {sessionError && <button type="button" className="btn-primary btn-block" disabled={submitting} onClick={retrySession}>{submitting ? '확인 중…' : '로그인 상태 다시 확인'}</button>}
    <p><a href="/login">새 비밀번호로 로그인</a></p>
  </section>

  return (
    <div className="auth-page">
      <h1>비밀번호 설정</h1>
      {user?.mustChangePassword && (
        <p className="notice">관리자가 생성한 계정입니다. 계속 사용하려면 새 비밀번호를 설정해주세요.</p>
      )}
      <form onSubmit={handleSubmit}>
        <label>
          현재 비밀번호(임시 비밀번호)
          <input
            type="password"
            value={currentPassword}
            readOnly={submitting}
            autoComplete="current-password"
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label>
          새 비밀번호 (8자 이상)
          <input
            type="password"
            value={newPassword}
            readOnly={submitting}
            autoComplete="new-password"
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <label>
          새 비밀번호 확인
          <input
            type="password"
            value={confirmPassword}
            readOnly={submitting}
            autoComplete="new-password"
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <button type="submit" className="btn-primary btn-block" disabled={submitting}>
          {submitting ? '변경 중...' : '비밀번호 변경'}
        </button>
      </form>
    </div>
  )
}
