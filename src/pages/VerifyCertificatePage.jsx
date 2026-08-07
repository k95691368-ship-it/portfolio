import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { formatKst } from '../lib/formatTime.js'

// 공개: 감사추적증명서 진위 확인. 로그인 불필요.
//
// 증명서는 계약 당사자가 아닌 사람(근로감독관, 법률 상담, 은행)에게 제시된다.
// 그 사람이 계정을 만들어야만 확인할 수 있다면 증명서로서 쓸모가 없다.
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export default function VerifyCertificatePage() {
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const [serial, setSerial] = useState(searchParams.get('serial') || '')
  const [fingerprint, setFingerprint] = useState('')
  const [result, setResult] = useState(null)
  const [failure, setFailure] = useState(null)
  const [loading, setLoading] = useState(false)

  const lookup = async (serialValue, sha) => {
    const trimmed = String(serialValue || '').trim()
    if (!trimmed) {
      toast.error('발급번호를 입력해주세요.')
      return
    }
    setLoading(true)
    setResult(null)
    setFailure(null)
    try {
      const query = new URLSearchParams({ serial: trimmed })
      if (sha) query.set('sha256', sha)
      const data = await api.get(`/verify-certificate?${query.toString()}`)
      setResult(data)
    } catch (err) {
      // 확인 실패는 화면에 남아 있어야 한다. 링크로 들어온 사람에게 토스트는
      // 몇 초 뒤 사라지고 빈 화면만 남는데, 그 사람은 "확인되지 않았다"는
      // 사실을 받으러 온 것이다. 사라지는 알림으로 답할 일이 아니다.
      setFailure(err.message)
    } finally {
      setLoading(false)
    }
  }

  // 링크로 들어오면 바로 확인해 준다 — 번호를 다시 옮겨 적게 하지 않는다.
  useEffect(() => {
    const fromUrl = searchParams.get('serial')
    if (fromUrl) lookup(fromUrl, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 받은 정본 문자열(.txt)을 이 브라우저에서 직접 해시해 지문을 채운다.
  // 파일은 서버로 보내지 않는다 — 확인하려는 사람의 문서를 우리가 가질 이유가 없다.
  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const hex = await sha256Hex(text)
      setFingerprint(hex)
      toast.info('이 브라우저에서 계산한 지문을 채웠습니다. 파일은 전송되지 않습니다.')
    } catch {
      toast.error('파일을 읽을 수 없습니다.')
    } finally {
      e.target.value = ''
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    lookup(serial, fingerprint.trim().toLowerCase() || null)
  }

  return (
    <div className="verify-page">
      <header className="page-header">
        <Link to="/" className="back-link">
          ← 첫 화면
        </Link>
        <h1>증명서 진위 확인</h1>
        <p>
          감사추적증명서에 적힌 발급번호로 발급 사실과 지문을 확인합니다. 로그인이 필요 없으며, 계약
          내용(임금·근로조건)은 표시되지 않습니다.
        </p>
      </header>

      <form className="verify-form" onSubmit={handleSubmit}>
        <label htmlFor="verify-serial">발급번호</label>
        <input
          id="verify-serial"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          placeholder="AC-XXXX-XXXX-XXXX"
          maxLength={32}
          autoComplete="off"
        />

        <label htmlFor="verify-fingerprint">
          증명서 지문 (선택) — 제시받은 증명서에 적힌 SHA-256 값
        </label>
        <input
          id="verify-fingerprint"
          value={fingerprint}
          onChange={(e) => setFingerprint(e.target.value)}
          placeholder="64자리 16진수 (선택 입력)"
          maxLength={64}
          autoComplete="off"
        />

        <label htmlFor="verify-file" className="verify-file-label">
          또는 정본 문자열 파일(.txt)을 골라 이 브라우저에서 직접 지문을 계산합니다. 파일은 전송되지
          않습니다.
        </label>
        <input id="verify-file" type="file" accept=".txt,text/plain" onChange={handleFile} />

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? '확인 중...' : '확인하기'}
        </button>
      </form>

      {failure && (
        <div className="verify-result verify-bad" role="status" aria-live="polite">
          <span className="badge badge-danger">확인되지 않았습니다</span>
          <p className="verify-detail">{failure}</p>
          <p className="verify-note">
            발급번호를 다시 확인해주세요. 번호가 맞는데도 확인되지 않는다면, 그 문서는 이곳에서 발급된
            증명서가 아닙니다.
          </p>
        </div>
      )}

      {result && (
        <div
          className={`verify-result ${result.valid ? 'verify-ok' : 'verify-bad'}`}
          role="status"
          aria-live="polite"
        >
          <span className={`badge ${result.valid ? 'badge-success' : 'badge-danger'}`}>
            {result.label}
          </span>
          <p className="verify-detail">{result.detail}</p>
          <dl className="verify-facts">
            <dt>발급번호</dt>
            <dd>
              <code>{result.serial}</code>
            </dd>
            <dt>발급 일시 (한국 시각)</dt>
            <dd>{formatKst(result.issuedAt)}</dd>
            <dt>증명서 지문</dt>
            <dd>
              <code className="verify-hash">{result.certificateSha256}</code>
            </dd>
            {result.documentSha256 && (
              <>
                <dt>서명 대상 문서 지문</dt>
                <dd>
                  <code className="verify-hash">{result.documentSha256}</code>
                </dd>
              </>
            )}
            <dt>담긴 이력</dt>
            <dd>{result.eventCount}건</dd>
            <dt>제시한 지문 대조</dt>
            <dd>
              {result.matchesProvided === null
                ? '대조하지 않음 (지문을 입력하면 함께 확인합니다)'
                : result.matchesProvided
                  ? '일치'
                  : '불일치'}
            </dd>
          </dl>
          <p className="verify-note">
            이 확인은 발급 기록과 증명서 지문의 일치를 확인합니다. 발급 시스템 자체를 신뢰할 수 없는
            상황까지 증명하지는 않습니다.
          </p>
        </div>
      )}
    </div>
  )
}
