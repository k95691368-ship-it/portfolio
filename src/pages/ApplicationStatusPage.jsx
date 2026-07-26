import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'

const STATUS_INFO = {
  submitted: { label: '심사 대기 중', badge: 'badge-warning', desc: '제출하신 지원서를 검토하고 있습니다. 조금만 기다려주세요.' },
  passed: {
    label: '서류 합격',
    badge: 'badge-success',
    desc: '축하합니다! 지원하신 이메일을 아이디로 로그인해 면접 절차를 진행해주세요. (임시 비밀번호는 담당자가 안내합니다)',
  },
  rejected: {
    label: '불합격',
    badge: 'badge-neutral',
    desc: '아쉽게도 이번 전형에서는 함께하지 못하게 되었습니다. 지원해주셔서 감사합니다.',
  },
}

export default function ApplicationStatusPage() {
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const [code, setCode] = useState(searchParams.get('code') || '')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const lookup = async (value) => {
    const trimmed = value.trim().toUpperCase()
    if (!trimmed) {
      toast.error('접수번호를 입력해주세요.')
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const data = await api.get(`/application-status?code=${encodeURIComponent(trimmed)}`)
      setResult(data)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  // URL 에 코드가 있으면 자동 조회
  useEffect(() => {
    const fromUrl = searchParams.get('code')
    if (fromUrl) lookup(fromUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()
    lookup(code)
  }

  const info = result ? STATUS_INFO[result.status] || STATUS_INFO.submitted : null

  return (
    <div className="status-page">
      <header className="page-header">
        <Link to="/jobs" className="back-link">
          ← 채용 공고 목록
        </Link>
        <h1>지원 현황 조회</h1>
        <p>지원 완료 시 발급된 접수번호로 심사 상태를 확인할 수 있습니다.</p>
      </header>

      <form className="status-form" onSubmit={handleSubmit}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="접수번호 입력 (예: ABCD2345EF)"
          maxLength={20}
        />
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? '조회 중...' : '조회하기'}
        </button>
      </form>

      {result && info && (
        <div className="status-card">
          <span className={`badge ${info.badge}`}>{info.label}</span>
          <h2>{result.postingTitle}</h2>
          <p className="status-meta">
            지원자 {result.applicantName} · 접수 {result.submittedAt?.slice(0, 10)}
            {result.reviewedAt && ` · 심사 완료 ${result.reviewedAt.slice(0, 10)}`}
          </p>
          <p className="status-desc">{info.desc}</p>
          {result.status === 'passed' && (
            <Link to="/login" className="btn-primary status-login-btn">
              로그인하러 가기
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
