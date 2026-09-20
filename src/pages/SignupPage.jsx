import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import EmailVerificationPending from '../components/EmailVerificationPending.jsx'

export default function SignupPage() {
  const { signup } = useAuth()
  const toast = useToast()
  const [pendingEmail, setPendingEmail] = useState('')
  const [form, setForm] = useState({
    email: '',
    password: '',
    role: 'candidate',
    displayName: '',
    companyName: '',
    remember: true,
  })
  const [submitting, setSubmitting] = useState(false)

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const result = await signup(form)
      if (result.verificationRequired) {
        setPendingEmail(result.email || form.email)
        setForm((current) => ({ ...current, password: '' }))
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (pendingEmail) return <EmailVerificationPending email={pendingEmail} />
  return (
    <div className="auth-page">
      <h1>회원가입</h1>
      <p>가입 이메일을 확인해야 계정을 사용할 수 있습니다.</p>
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
        <label className="checkbox-label remember-me"><input type="checkbox" checked={form.remember} onChange={(event) => setForm((current) => ({ ...current, remember: event.target.checked }))} />이메일 확인 후 로그인 유지</label>
        <p>공용 기기에서는 선택하지 말고 이용 후 로그아웃해주세요.</p>
        <button type="submit" className="btn-primary btn-block" disabled={submitting}>
          가입하기
        </button>
      </form>
      <p>
        이미 계정이 있으신가요? <Link to="/login">로그인</Link>
      </p>
    </div>
  )
}
