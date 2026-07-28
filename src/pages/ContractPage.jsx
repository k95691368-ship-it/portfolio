import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import SignatureModal from '../components/SignatureModal.jsx'
import { IDENTITY_FIELDS, TERM_FIELDS, SOCIAL_INSURANCE_FIELDS } from '../lib/contractTemplate.js'

const FIELD_LABELS = {
  ...Object.fromEntries([...IDENTITY_FIELDS, ...TERM_FIELDS].map((f) => [f.key, f.label])),
  socialInsurance: '사회보험 적용',
  customTerms: '그 밖의 사항',
}

function formatHistoryValue(field, value) {
  if (value === null || value === undefined || value === '') return '(비어 있음)'
  if (field === 'socialInsurance') {
    try {
      const obj = JSON.parse(value)
      const on = SOCIAL_INSURANCE_FIELDS.filter((f) => obj[f.key]).map((f) => f.label)
      return on.length > 0 ? on.join(', ') : '(없음)'
    } catch {
      return String(value)
    }
  }
  if (field === 'customTerms') {
    try {
      const arr = JSON.parse(value)
      return arr.map((c) => `${c.label}: ${c.value}`).join(', ') || '(없음)'
    } catch {
      return String(value)
    }
  }
  return String(value)
}

const EMPTY_FORM = {
  employerName: '',
  employerAddress: '',
  employeeName: '',
  employeeAddress: '',
  contractStartDate: '',
  contractEndDate: '',
  workLocation: '',
  jobDescription: '',
  workHoursStart: '',
  workHoursEnd: '',
  workDays: '',
  restDays: '',
  wageBaseAmount: '',
  wagePayMethod: '',
  wagePayDate: '',
  annualLeave: '',
  uniformSize: '',
  socialInsurance: {},
  customTerms: [],
}

const SEVERITY_BADGE = { high: 'badge-danger', medium: 'badge-warning', info: 'badge-neutral' }

// 서명 전 최종 안전 점검 — 합의 불일치 / 법적 문제 / 필수 누락
function PreSignCheck({ check }) {
  const { diffs, legalIssues, missingFields } = check
  const clean = diffs.length === 0 && legalIssues.length === 0 && missingFields.length === 0

  return (
    <section className={`presign-check${clean ? ' clean' : ''}`}>
      <h3>서명 전 최종 확인</h3>

      {clean && (
        <p className="presign-ok">
          ✓ 채팅에서 합의한 조건과 계약서 내용이 일치하며, 법적 검토에서도 문제가 발견되지 않았습니다.
        </p>
      )}

      {diffs.length > 0 && (
        <div className="presign-group">
          <p className="presign-group-title">
            <span className="badge badge-danger">합의 내용과 다름</span> 면접 대화에서 합의된 조건이 이후 수정되었습니다.
          </p>
          <table className="presign-table">
            <thead>
              <tr>
                <th>항목</th>
                <th>대화에서 합의</th>
                <th>현재 계약서</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((d) => (
                <tr key={d.field}>
                  <td>{d.label}</td>
                  <td className="presign-agreed">{d.agreed}</td>
                  <td className="presign-current">{d.current}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {legalIssues.length > 0 && (
        <div className="presign-group">
          <p className="presign-group-title">법적 검토</p>
          <ul className="presign-list">
            {legalIssues.map((issue, i) => (
              <li key={i}>
                <span className={`badge ${SEVERITY_BADGE[issue.severity] || 'badge-neutral'}`}>
                  {issue.title}
                </span>{' '}
                {issue.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {missingFields.length > 0 && (
        <div className="presign-group">
          <p className="presign-group-title">
            <span className="badge badge-warning">필수 항목 누락</span>
          </p>
          <p className="presign-missing">
            {missingFields.map((m) => m.label).join(', ')} 항목이 비어 있습니다. (근로기준법 제17조 명시사항)
          </p>
        </div>
      )}
    </section>
  )
}

export default function ContractPage() {
  const { roomId } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  const [room, setRoom] = useState(null)
  const [contractMeta, setContractMeta] = useState({ hireConfirmed: false })
  const [form, setForm] = useState(EMPTY_FORM)
  const [signatures, setSignatures] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [signingRole, setSigningRole] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [aiDocument, setAiDocument] = useState(null)
  const [drafting, setDrafting] = useState(false)
  const [history, setHistory] = useState([])
  const [auditTrail, setAuditTrail] = useState(null)
  const [signedContract, setSignedContract] = useState(null)
  const [signedMeta, setSignedMeta] = useState({ emailConfigured: true, candidateEmailMasked: null })
  const [storing, setStoring] = useState(false)
  const [preSign, setPreSign] = useState(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const printRef = useRef(null)

  const loadAll = useCallback(async () => {
    // 이 화면에 필요한 모든 정보를 한 번의 요청으로 받는다.
    const view = await api.get(`/rooms/${roomId}/contract-view`)
    const roomData = view.room
    const contractData = view.contract
    const sigData = { signatures: view.signatures }
    const historyData = { history: view.history }
    const auditData = view.auditTrail
    const preSignData = view.preSignCheck
    const storedData = view.signedContract
    setAuditTrail(auditData)
    setRoom(roomData)
    setHistory(historyData.history ?? [])
    setContractMeta({
      hireConfirmed: contractData.hireConfirmed,
      hireConfirmedAt: contractData.hireConfirmedAt,
      confirmationExcerpt: contractData.confirmationExcerpt,
    })
    setAiDocument(contractData.terms?.aiDocument ?? null)

    const t = contractData.terms || {}
    const company = roomData.participants.find((p) => p.role === 'company')
    const candidate = roomData.participants.find((p) => p.role === 'candidate')

    setForm({
      employerName: t.employerName ?? company?.companyName ?? company?.displayName ?? '',
      employerAddress: t.employerAddress ?? '',
      employeeName: t.employeeName ?? candidate?.displayName ?? '',
      employeeAddress: t.employeeAddress ?? '',
      contractStartDate: t.contractStartDate ?? '',
      contractEndDate: t.contractEndDate ?? '',
      workLocation: t.workLocation ?? '',
      jobDescription: t.jobDescription ?? '',
      workHoursStart: t.workHoursStart ?? '',
      workHoursEnd: t.workHoursEnd ?? '',
      workDays: t.workDays ?? '',
      restDays: t.restDays ?? '',
      wageBaseAmount: t.wageBaseAmount ?? '',
      wagePayMethod: t.wagePayMethod ?? '',
      wagePayDate: t.wagePayDate ?? '',
      annualLeave: t.annualLeave ?? '',
      uniformSize: t.uniformSize ?? '',
      socialInsurance: t.socialInsurance ?? {},
      customTerms: t.customTerms ?? [],
    })
    setSignatures(sigData.signatures)

    // 서명 전 최종 안전 점검은 아직 체결되지 않은 계약서에만 보여준다.
    setPreSign(roomData.status === 'signed' ? null : preSignData)

    if (roomData.status === 'signed' && storedData) {
      setSignedContract(storedData.stored)
      setSignedMeta({
        emailConfigured: storedData.emailConfigured,
        candidateEmailMasked: storedData.candidateEmailMasked,
      })
    }
  }, [roomId])

  useEffect(() => {
    loadAll()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [loadAll])

  const updateField = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const toggleInsurance = (key) =>
    setForm((f) => ({ ...f, socialInsurance: { ...f.socialInsurance, [key]: !f.socialInsurance[key] } }))
  const updateCustomTerm = (idx, field, value) =>
    setForm((f) => {
      const next = [...f.customTerms]
      next[idx] = { ...next[idx], [field]: value }
      return { ...f, customTerms: next }
    })
  const addCustomTerm = () => setForm((f) => ({ ...f, customTerms: [...f.customTerms, { label: '', value: '' }] }))
  const removeCustomTerm = (idx) =>
    setForm((f) => ({ ...f, customTerms: f.customTerms.filter((_, i) => i !== idx) }))

  const isSigned = room?.status === 'signed'
  const myRole = room?.myRole
  const otherRole = myRole === 'company' ? 'candidate' : 'company'
  const mySignature = signatures.find((s) => s.role === myRole)
  const otherSignature = signatures.find((s) => s.role === otherRole)
  const canEdit = !isSigned && myRole === 'company'

  const handleSave = async () => {
    setSaving(true)
    try {
      const filteredCustomTerms = form.customTerms.filter((c) => c.label && c.value)
      const droppedCount = form.customTerms.length - filteredCustomTerms.length
      const payload = {
        ...form,
        wageBaseAmount: form.wageBaseAmount === '' || form.wageBaseAmount === null ? null : Number(form.wageBaseAmount),
        customTerms: filteredCustomTerms,
      }
      await api.patch(`/rooms/${roomId}/contract`, payload)
      setForm((f) => ({ ...f, customTerms: filteredCustomTerms }))
      toast.success(
        droppedCount > 0
          ? `저장되었습니다. (라벨/값이 비어있는 기타 항목 ${droppedCount}개는 저장되지 않았습니다.)`
          : '정상적으로 저장되었습니다.'
      )
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDraftDocument = async () => {
    setDrafting(true)
    try {
      const data = await api.post(`/rooms/${roomId}/contract-draft`, form)
      setAiDocument(data.articles)
      toast.success('AI 계약서 문장이 작성되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDrafting(false)
    }
  }

  const handleSign = async (imageDataUrl) => {
    try {
      await api.post(`/rooms/${roomId}/sign`, { imageDataUrl })
      setSigningRole(null)
      await loadAll()
      toast.success('서명이 완료되었습니다.')
    } catch (err) {
      toast.error(err.message)
    }
  }

  // PDF 생성 라이브러리는 600KB가 넘는데, 계약서를 읽거나 서명만 하는 경우에는
  // 쓰이지 않는다. 그래서 페이지 진입 시가 아니라 실제로 내보내기를 누른 순간에
  // 불러온다.
  const buildPdf = async () => {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ])
    const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff' })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = pageWidth
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    let heightLeft = imgHeight
    let position = 0

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight

    while (heightLeft > 0) {
      position -= pageHeight
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }
    return pdf
  }

  const handleExportPdf = async () => {
    setExporting(true)
    try {
      const pdf = await buildPdf()
      pdf.save('근로계약서.pdf')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setExporting(false)
    }
  }

  const handleStoreAndSend = async () => {
    setStoring(true)
    try {
      const pdf = await buildPdf()
      const blob = pdf.output('blob')
      const fd = new FormData()
      fd.append('pdf', blob, '근로계약서.pdf')
      const data = await api.upload(`/rooms/${roomId}/signed-contract`, fd)
      setSignedContract(data.stored)
      setSignedMeta((m) => ({ ...m, emailConfigured: data.emailConfigured }))
      toast.success(
        data.stored?.emailStatus === 'sent'
          ? '계약서를 저장하고 이메일로 사본을 전송했습니다.'
          : '계약서가 저장되었습니다.'
      )
    } catch (err) {
      toast.error(err.message)
    } finally {
      setStoring(false)
    }
  }

  if (loading) return <p>불러오는 중...</p>
  if (error && !room) return <p className="error">{error}</p>

  return (
    <div className="contract-page">
      <header className="page-header">
        <Link to={`/rooms/${roomId}`} className="back-link">
          ← 면접방으로
        </Link>
        <h1>전자근로계약서</h1>
        <p>{room.title}</p>
      </header>

      {!contractMeta.hireConfirmed && (
        <p className="notice">
          아직 채용이 확정되지 않았습니다. 계약 조건은 지금 미리 작성할 수 있지만, 서명은 채용이 확정된 후에 가능합니다.
        </p>
      )}
      {isSigned && <p className="signed-banner">양측 서명이 완료되었습니다.</p>}

      <section className="contract-form">
        <h2>{myRole === 'company' ? '계약 조건 입력/수정' : '계약 조건 확인'}</h2>
        {myRole !== 'company' && !isSigned && (
          <p className="notice">계약 조건은 회사(고용) 측만 작성·수정할 수 있습니다. 내용을 확인한 뒤 서명해주세요.</p>
        )}
        <fieldset disabled={!canEdit}>
          <h3>당사자 정보</h3>
          {IDENTITY_FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <input value={form[f.key] ?? ''} onChange={(e) => updateField(f.key, e.target.value)} />
            </label>
          ))}

          <h3>근로조건</h3>
          {TERM_FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type={f.type ?? 'text'}
                placeholder={f.placeholder}
                value={form[f.key] ?? ''}
                onChange={(e) => updateField(f.key, e.target.value)}
              />
            </label>
          ))}

          <h3>사회보험 적용</h3>
          {SOCIAL_INSURANCE_FIELDS.map((f) => (
            <label key={f.key} className="checkbox-label">
              <input
                type="checkbox"
                checked={!!form.socialInsurance[f.key]}
                onChange={() => toggleInsurance(f.key)}
              />
              {f.label}
            </label>
          ))}

          <h3>그 밖의 사항</h3>
          {form.customTerms.map((c, idx) => (
            <div key={idx} className="custom-term-row">
              <input
                placeholder="항목명"
                value={c.label}
                onChange={(e) => updateCustomTerm(idx, 'label', e.target.value)}
              />
              <input
                placeholder="내용"
                value={c.value}
                onChange={(e) => updateCustomTerm(idx, 'value', e.target.value)}
              />
              <button type="button" className="btn-danger btn-sm" onClick={() => removeCustomTerm(idx)}>
                삭제
              </button>
            </div>
          ))}
          <button type="button" onClick={addCustomTerm}>
            + 항목 추가
          </button>
        </fieldset>

        {canEdit && (
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
        )}
      </section>

      {canEdit && (user.isAdmin || user.isRecruiter) && (
        <section className="ai-draft">
          <h2>AI 계약서 문장 자동 작성</h2>
          <p>위에 입력한 조건을 바탕으로 표준근로계약서 형식의 계약서 문장을 AI가 작성합니다.</p>
          <button type="button" onClick={handleDraftDocument} disabled={drafting}>
            {drafting ? 'AI가 계약서를 작성하는 중...' : aiDocument ? 'AI 계약서 다시 작성하기' : 'AI로 계약서 작성하기'}
          </button>
        </section>
      )}

      <section className="signature-section">
        <h2>서명</h2>
        <div className="signature-status-row">
          <div>
            <p>회사</p>
            {signatures.find((s) => s.role === 'company') ? (
              <img
                src={signatures.find((s) => s.role === 'company').imageDataUrl}
                alt="회사 서명"
                className="signature-thumb"
              />
            ) : (
              <p>미서명</p>
            )}
          </div>
          <div>
            <p>지원자</p>
            {signatures.find((s) => s.role === 'candidate') ? (
              <img
                src={signatures.find((s) => s.role === 'candidate').imageDataUrl}
                alt="지원자 서명"
                className="signature-thumb"
              />
            ) : (
              <p>미서명</p>
            )}
          </div>
        </div>
        {(myRole === 'company' || myRole === 'candidate') && !mySignature && (
          <>
            {preSign?.ready && <PreSignCheck check={preSign} />}
            {preSign?.hasBlocking && (
              <label className="checkbox-label presign-ack">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                위 확인 사항을 모두 검토했으며, 이 내용으로 서명합니다.
              </label>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={() => setSigningRole(myRole)}
              disabled={!contractMeta.hireConfirmed || (preSign?.hasBlocking && !acknowledged)}
            >
              서명하기
            </button>
            {!contractMeta.hireConfirmed && <p className="notice">채용이 확정된 후에 서명할 수 있습니다.</p>}
          </>
        )}
        {myRole === 'admin' && <p className="notice">관리자 열람 모드 — 서명은 참여자만 가능합니다.</p>}
        {mySignature && !otherSignature && <p>상대방의 서명을 기다리고 있습니다.</p>}
      </section>

      {isSigned && (
        <section className="signed-contract-section">
          <h2>서명 완료 계약서 보관 · 전송</h2>
          {signedContract ? (
            <>
              <p className="save-message">
                계약서가 저장되었습니다. ({signedContract.createdAt})
                {signedContract.emailStatus === 'sent' && ' · 이메일로 사본 전송 완료'}
                {signedContract.emailStatus === 'failed' && ' · 이메일 전송 실패'}
                {signedContract.emailStatus === 'not_sent' &&
                  !signedMeta.emailConfigured &&
                  ' · 이메일 미설정(저장만 완료)'}
              </p>
              <p>
                <a href={`/api/rooms/${roomId}/signed-contract-file`}>저장된 계약서 PDF 다운로드 →</a>
              </p>
              {signedContract.sha256Hash && (
                <p className="integrity-hash">
                  문서 무결성 지문(SHA-256): <code>{signedContract.sha256Hash}</code>
                  <br />
                  <em>
                    다운로드한 PDF의 SHA-256 해시가 위 값과 일치하면 저장 이후 위·변조되지 않았음이
                    증명됩니다.
                  </em>
                </p>
              )}
            </>
          ) : myRole === 'company' ? (
            <p className="notice">
              서명이 완료되었습니다. 아래 버튼을 누르면 계약서를 서버에 보관하고
              {signedMeta.candidateEmailMasked ? ` 지원자(${signedMeta.candidateEmailMasked})` : ' 지원자'}에게
              이메일로 전달합니다.
            </p>
          ) : (
            <p className="notice">회사 측에서 계약서를 저장·전송하면 여기에서 사본을 받을 수 있습니다.</p>
          )}

          {!signedMeta.emailConfigured && myRole === 'company' && (
            <p className="notice">
              이메일 발송 기능이 아직 설정되지 않았습니다. 지금은 서버 보관·다운로드만 가능합니다.
            </p>
          )}
          {myRole === 'company' && (
            <button type="button" className="btn-primary" onClick={handleStoreAndSend} disabled={storing}>
              {storing
                ? '처리 중...'
                : signedContract
                  ? '계약서 다시 저장·전송'
                  : '계약서 저장 및 지원자에게 이메일 전송'}
            </button>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="contract-history">
          <h2>수정 이력 ({history.length})</h2>
          <ul className="history-list">
            {history.map((entry) => (
              <li key={entry.id} className="history-entry">
                <p className="history-meta">
                  {entry.createdAt} · {entry.editorName}
                  {entry.editorRole === 'company' ? ' (회사)' : entry.editorRole === 'candidate' ? ' (지원자)' : ''}
                </p>
                <ul className="history-changes">
                  {entry.changes.map((c, i) => (
                    <li key={i}>
                      <strong>{FIELD_LABELS[c.field] || c.field}</strong>: {formatHistoryValue(c.field, c.from)}
                      {' → '}
                      {formatHistoryValue(c.field, c.to)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button type="button" onClick={handleExportPdf} disabled={exporting}>
        {exporting ? 'PDF 생성 중...' : 'PDF 다운로드'}
      </button>

      {signingRole && (
        <SignatureModal
          signerLabel={signingRole === 'company' ? '회사' : '지원자'}
          onSave={handleSign}
          onClose={() => setSigningRole(null)}
        />
      )}

      <div className="contract-print" ref={printRef}>
        <h2 className="print-title">표준근로계약서</h2>
        <p>
          {form.employerName || '사업체명 미기재'} (이하 "사업주")과(와) {form.employeeName || '근로자 미기재'}
          (이하 "근로자")은 다음과 같이 근로계약을 체결한다.
        </p>

        {aiDocument ? (
          <div className="contract-articles">
            {aiDocument.map((article, idx) => (
              <div key={idx} className="contract-article">
                <h3>{article.heading}</h3>
                <p>{article.body}</p>
              </div>
            ))}
          </div>
        ) : (
          <table>
            <tbody>
              {IDENTITY_FIELDS.map((f) => (
                <tr key={f.key}>
                  <th>{f.label}</th>
                  <td>{form[f.key] || '-'}</td>
                </tr>
              ))}
              {TERM_FIELDS.map((f) => (
                <tr key={f.key}>
                  <th>{f.label}</th>
                  <td>{form[f.key] || '-'}</td>
                </tr>
              ))}
              <tr>
                <th>사회보험 적용</th>
                <td>
                  {SOCIAL_INSURANCE_FIELDS.filter((f) => form.socialInsurance[f.key])
                    .map((f) => f.label)
                    .join(', ') || '-'}
                </td>
              </tr>
              {form.customTerms.filter((c) => c.label && c.value).length > 0 && (
                <tr>
                  <th>그 밖의 사항</th>
                  <td>{form.customTerms.map((c) => `${c.label}: ${c.value}`).join(', ')}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        <div className="print-signatures">
          <div>
            <p>사업주 (회사)</p>
            {signatures.find((s) => s.role === 'company') && (
              <img src={signatures.find((s) => s.role === 'company').imageDataUrl} alt="회사 서명" />
            )}
          </div>
          <div>
            <p>근로자 (지원자)</p>
            {signatures.find((s) => s.role === 'candidate') && (
              <img src={signatures.find((s) => s.role === 'candidate').imageDataUrl} alt="지원자 서명" />
            )}
          </div>
        </div>

        {auditTrail && auditTrail.events.length > 0 && (
          <div className="audit-trail-print">
            <h3>계약 이력 증명 (감사추적)</h3>
            <table>
              <tbody>
                {auditTrail.events.map((e, i) => (
                  <tr key={i}>
                    <td className="audit-time">{e.at}</td>
                    <td>{e.event}</td>
                    <td>{e.detail || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {auditTrail.documentHash && (
              <p className="audit-hash">
                문서 무결성 지문(SHA-256): {auditTrail.documentHash}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
