import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function SignupPage() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    email: '',
    password: '',
    role: 'candidate',
    displayName: '',
    companyName: '',
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await signup(form)
      navigate('/dashboard')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <h1>회원가입</h1>
      <form onSubmit={handleSubmit}>
        <label>
          역할
          <select value={form.role} onChange={update('role')}>
            <option value="candidate">구직자</option>
            <option value="company">회사(면접관)</option>
          </select>
        </label>
        <label>
          이름
          <input value={form.displayName} onChange={update('displayName')} required />
        </label>
        {form.role === 'company' && (
          <label>
            회사명
            <input value={form.companyName} onChange={update('companyName')} />
          </label>
        )}
        <label>
          이메일
          <input type="email" value={form.email} onChange={update('email')} required />
        </label>
        <label>
          비밀번호 (8자 이상)
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            required
            minLength={8}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          가입하기
        </button>
      </form>
      <p>
        이미 계정이 있으신가요? <Link to="/login">로그인</Link>
      </p>
    </div>
  )
}
