import { useEffect, useRef, useState } from 'react'
import { formatKstDate } from '../lib/formatTime.js'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'

const STATUS_INFO = {
  withdrawn: { label: '지원 철회', badge: 'badge-neutral', desc: '본인 요청으로 지원이 철회되었습니다.' },
  submitted: { label: '심사 대기 중', badge: 'badge-warning', desc: '제출하신 지원서를 검토하고 있습니다. 조금만 기다려주세요.' },
  passed: {
    label: '서류 합격',
    badge: 'badge-success',
    desc: '서류 전형에 합격했습니다. 결과 이메일의 입장 코드를 채용 공고 화면에 입력해 면접 절차를 진행해주세요.',
  },
  rejected: {
    label: '불합격',
    badge: 'badge-neutral',
    desc: '아쉽게도 이번 전형에서는 함께하지 못하게 되었습니다. 지원해주셔서 감사합니다.',
  },
}

export default function ApplicationStatusPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const [code, setCode] = useState(searchParams.get('code') || '')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState('')
  const lifetime = useRef(null)
  const pendingLookup = useRef(null)
  const pendingClaim = useRef(null)
  const confirmedReceipt = useRef(null)
  const generation = useRef(0)
  const identity = useRef(null)
  identity.current = user?.id ?? user?.role ?? null

  useEffect(() => {
    const scope = {}
    lifetime.current = scope
    return () => {
      if (lifetime.current === scope) lifetime.current = null
      generation.current += 1
      pendingLookup.current?.controller.abort()
      pendingLookup.current = null
      pendingClaim.current?.controller.abort()
      pendingClaim.current = null
      confirmedReceipt.current = null
    }
  }, [])

  const cancelLookup = () => {
    generation.current += 1
    pendingLookup.current?.controller.abort()
    pendingLookup.current = null
    confirmedReceipt.current = null
    setLoading(false)
  }

  const claim = async () => {
    const receipt = confirmedReceipt.current
    if (!lifetime.current || pendingClaim.current || pendingLookup.current || result?.claimed
      || !receipt || receipt.status !== 'submitted' || receipt.claimed || user?.role !== 'candidate') return
    const ticket = { scope: lifetime.current, identity: identity.current, code: receipt.lookupCode, controller: new AbortController() }
    pendingClaim.current = ticket
    const current = () => lifetime.current === ticket.scope && pendingClaim.current === ticket && identity.current === ticket.identity
    setClaiming(true)
    setError('')
    try {
      const response = await api.post('/applications/claim', { code: ticket.code }, { signal: ticket.controller.signal })
      if (!current()) return
      if (response?.ok !== true) throw new Error('계정 연결 결과를 확인하지 못했습니다. 내 지원 현황을 확인한 뒤 필요하면 다시 시도해주세요.')
      if (confirmedReceipt.current?.lookupCode === ticket.code) confirmedReceipt.current = { ...confirmedReceipt.current, claimed: true }
      setResult(previous => previous?.lookupCode === ticket.code ? { ...previous, claimed: true } : previous)
      toast.success('이 지원서를 본인 계정에 연결했습니다.')
    } catch (err) {
      if (current()) setError(err.message || '계정 연결 결과를 확인하지 못했습니다.')
    } finally {
      if (pendingClaim.current === ticket) { pendingClaim.current = null; if (lifetime.current === ticket.scope) setClaiming(false) }
    }
  }

  const lookup = async (value) => {
    const trimmed = value.trim().toUpperCase()
    if (!lifetime.current || pendingClaim.current || pendingLookup.current?.code === trimmed) return
    if (!trimmed) {
      cancelLookup()
      setResult(null)
      setError('접수번호를 입력해주세요.')
      return
    }
    pendingLookup.current?.controller.abort()
    const ticket = { scope: lifetime.current, code: trimmed, generation: ++generation.current, controller: new AbortController() }
    pendingLookup.current = ticket
    const current = () => lifetime.current === ticket.scope && pendingLookup.current === ticket && generation.current === ticket.generation
    setLoading(true)
    setResult(null)
    confirmedReceipt.current = null
    setError('')
    try {
      const data = await api.get(`/application-status?code=${encodeURIComponent(trimmed)}`, { signal: ticket.controller.signal })
      if (!current()) return
      if (!data || !Object.hasOwn(STATUS_INFO, data.status) || typeof data.postingTitle !== 'string'
        || typeof data.applicantName !== 'string' || typeof data.submittedAt !== 'string' || !Number.isFinite(Date.parse(data.submittedAt))) {
        throw new Error('지원 현황 응답을 확인하지 못했습니다. 다시 조회해주세요.')
      }
      const receipt = { ...data, lookupCode: trimmed, claimed: false }
      confirmedReceipt.current = receipt
      setResult(receipt)
    } catch (err) {
      if (current()) setError(err.message || '지원 현황을 불러오지 못했습니다.')
    } finally {
      if (current()) { pendingLookup.current = null; setLoading(false) }
    }
  }

  // URL 에 코드가 있으면 자동 조회
  useEffect(() => {
    const fromUrl = searchParams.get('code')
    if (fromUrl) { setCode(fromUrl); void lookup(fromUrl) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

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
        <Link to="/application-manage">접수번호 찾기 · 제출 내용 확인·수정 · 지원 철회</Link>
      </header>

      {/* 안내 문구만 칸 안에 넣어 두면, 입력을 시작하는 순간 이 칸이 무엇을
          입력하는 칸인지 알 방법이 없어진다. 이름을 따로 붙인다. */}
      <form className="status-form" onSubmit={handleSubmit}>
        <label htmlFor="lookup-code" className="sr-only">
          접수번호
        </label>
        <input
          id="lookup-code"
          value={code}
          disabled={claiming}
          onChange={(e) => {
            if (pendingClaim.current) return
            cancelLookup()
            setCode(e.target.value)
            setResult(null)
            setError('')
          }}
          placeholder="접수번호 입력 (예: ABCD2345EF)"
          maxLength={20}
          autoComplete="off"
        />
        <button type="submit" className="btn-primary" disabled={loading || claiming}>
          {loading ? '조회 중...' : '조회하기'}
        </button>
      </form>
      {loading && <button type="button" className="btn-secondary" onClick={cancelLookup}>조회 취소</button>}
      {error && <p className="error" role="alert">{error}</p>}

      {result && info && (
        <div className="status-card" role="status" aria-live="polite">
          <span className={`badge ${info.badge}`}>{info.label}</span>
          <h2>{result.postingTitle}</h2>
          <p>조회한 접수번호: <code>{result.lookupCode}</code></p>
          <p className="status-meta">
            지원자 {result.applicantName} · 접수 {formatKstDate(result.submittedAt)}
            {result.reviewedAt && ` · 심사 완료 ${formatKstDate(result.reviewedAt)}`}
          </p>
          <p className="status-desc">{info.desc}</p>
          {result.status === 'submitted' && (user?.role === 'candidate'
            ? result.claimed ? <p role="status">이 지원서를 본인 계정에 연결했습니다.</p>
              : <button type="button" className="btn-secondary" disabled={loading || claiming} onClick={claim}>{claiming ? '연결 중...' : '접수번호로 내 계정에 연결'}</button>
            : <Link to="/login" className="back-link">기존 지원자 계정이 있다면 로그인 후 접수번호로 연결해주세요.</Link>)}
          {result.status === 'passed' && (
            <Link to="/jobs" className="btn-primary status-login-btn">
              면접방 입장 코드 입력하기
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
