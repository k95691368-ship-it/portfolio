import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { api } from '../api/client.js'

export default function ChangePasswordPage() {
  const { user, refresh } = useAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError('새 비밀번호가 일치하지 않습니다.')
      return
    }
    setSubmitting(true)
    try {
      await api.post('/change-password', { currentPassword, newPassword })
      await refresh()
      navigate('/dashboard')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

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
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label>
          새 비밀번호 (8자 이상)
          <input
            type="password"
            value={newPassword}
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
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-primary btn-block" disabled={submitting}>
          {submitting ? '변경 중...' : '비밀번호 변경'}
        </button>
      </form>
    </div>
  )
}
