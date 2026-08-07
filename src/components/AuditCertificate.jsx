import { useCallback, useState } from 'react'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { formatKst } from '../lib/formatTime.js'

// 감사추적증명서 — 계약 이력을 계약서에서 떼어낸 독립 문서.
//
// 계약서 PDF 안에 이력을 적어 넣으면 그 이력은 계약서를 가진 사람만 볼 수 있고,
// PDF 바이트가 조금만 달라져도 지문이 달라진다. 증명서는 발급번호와 재현 가능한
// 지문을 달고 따로 나가, 계약 내용을 보이지 않고도 "이 계약이 언제 어떻게
// 체결됐는지"를 제3자에게 확인시킬 수 있다.
// initial: 계약서 화면이 한 번의 요청으로 함께 받아 온 발급 목록.
// 예전에는 이 화면이 마운트될 때마다 목록을 따로 한 번 더 요청했다. 같은 데이터를
// 이미 받아 놓고 다시 묻는 것이라, 계약서를 열 때마다 요청이 하나씩 더 나갔다.
// 발급 뒤에만 다시 읽는다.
export default function AuditCertificate({ roomId, canIssue, hasSignature, initial }) {
  const toast = useToast()
  const [refreshed, setRefreshed] = useState(null)
  const [issuing, setIssuing] = useState(false)
  const [issued, setIssued] = useState(null)

  const certificates = refreshed ?? initial ?? []

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/rooms/${roomId}/audit-certificate`)
      setRefreshed(data.certificates ?? [])
    } catch {
      // 목록을 못 읽는 것으로 계약서 화면 전체를 막지 않는다.
    }
  }, [roomId])

  const handleIssue = async () => {
    setIssuing(true)
    try {
      const data = await api.post(`/rooms/${roomId}/audit-certificate`, {})
      setIssued(data)
      await load()
      toast.success(`증명서가 발급되었습니다. 발급번호 ${data.serial}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setIssuing(false)
    }
  }

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label}을(를) 복사했습니다.`)
    } catch {
      toast.error('복사할 수 없습니다. 직접 선택해 복사해주세요.')
    }
  }

  // 받는 사람이 직접 해시를 계산해 볼 수 있도록 정본 문자열을 그대로 내려준다.
  // 우리 화면을 믿어야만 확인되는 지문은 절반짜리 증명이다.
  const downloadCanonical = () => {
    const blob = new Blob([issued.canonicalText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${issued.serial}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!hasSignature && certificates.length === 0) return null

  const verifyUrl = (serial) => `${window.location.origin}/verify?serial=${serial}`

  return (
    <section className="audit-certificate">
      <div className="period-head">
        <h2>감사추적증명서</h2>
        {certificates.length > 0 && (
          <span className="badge badge-accent">발급 {certificates.length}건</span>
        )}
      </div>
      <p className="period-detail">
        서명 기록·교부 이력·문서 지문을 발급 시점 그대로 동결해 한 장으로 만듭니다. 계약 내용은 담기지
        않으므로, 임금이나 근로조건을 보이지 않고도 계약 체결 사실을 제3자에게 확인시킬 수 있습니다.
      </p>

      {canIssue && (
        <button type="button" className="btn-primary" onClick={handleIssue} disabled={issuing || !hasSignature}>
          {issuing ? '발급 중...' : certificates.length > 0 ? '증명서 새로 발급' : '증명서 발급'}
        </button>
      )}
      {canIssue && !hasSignature && (
        <p className="notice">서명이 하나 이상 있어야 발급할 수 있습니다.</p>
      )}

      {issued && (
        <div className="certificate-issued" role="status">
          <p className="certificate-serial">
            발급번호 <code>{issued.serial}</code>
            <button type="button" className="btn-sm" onClick={() => copy(issued.serial, '발급번호')}>
              복사
            </button>
          </p>
          <p className="certificate-fingerprint">
            증명서 지문(SHA-256) <code>{issued.certificateSha256}</code>
          </p>
          <p className="period-detail">
            아래 정본 문자열을 SHA-256으로 해시하면 위 지문과 같아야 합니다. 우리 화면을 거치지 않고도
            직접 확인할 수 있도록 원본을 그대로 내려받을 수 있습니다.
          </p>
          <div className="certificate-actions">
            <button type="button" className="btn-sm" onClick={downloadCanonical}>
              정본 문자열 내려받기 (.txt)
            </button>
            <button type="button" className="btn-sm" onClick={() => copy(verifyUrl(issued.serial), '확인 링크')}>
              확인 링크 복사
            </button>
          </div>
        </div>
      )}

      {certificates.length > 0 && (
        <ul className="certificate-list">
          {certificates.map((c) => (
            <li key={c.serial}>
              <div className="certificate-row">
                <code>{c.serial}</code>
                <span className="certificate-meta">
                  {formatKst(c.issuedAt)} · 이력 {c.eventCount}건
                  {c.revokedAt && <span className="compare-concern"> · 취소됨</span>}
                </span>
              </div>
              <a
                className="certificate-verify-link"
                href={`/verify?serial=${c.serial}`}
                target="_blank"
                rel="noreferrer"
              >
                이 번호로 진위 확인 →
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
