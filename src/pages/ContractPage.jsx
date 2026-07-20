import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { api } from '../api/client.js'
import SignatureModal from '../components/SignatureModal.jsx'
import { IDENTITY_FIELDS, TERM_FIELDS, SOCIAL_INSURANCE_FIELDS } from '../lib/contractTemplate.js'

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

export default function ContractPage() {
  const { roomId } = useParams()
  const [room, setRoom] = useState(null)
  const [contractMeta, setContractMeta] = useState({ hireConfirmed: false })
  const [form, setForm] = useState(EMPTY_FORM)
  const [signatures, setSignatures] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [signingRole, setSigningRole] = useState(null)
  const [exporting, setExporting] = useState(false)
  const printRef = useRef(null)

  const loadAll = useCallback(async () => {
    const [roomData, contractData, sigData] = await Promise.all([
      api.get(`/rooms/${roomId}`),
      api.get(`/rooms/${roomId}/contract`),
      api.get(`/rooms/${roomId}/signatures`),
    ])
    setRoom(roomData)
    setContractMeta({
      hireConfirmed: contractData.hireConfirmed,
      hireConfirmedAt: contractData.hireConfirmedAt,
      confirmationExcerpt: contractData.confirmationExcerpt,
    })

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
  const canEdit = contractMeta.hireConfirmed && !isSigned

  const handleSave = async () => {
    setSaving(true)
    setSaveMessage('')
    setError('')
    try {
      const payload = {
        ...form,
        wageBaseAmount: form.wageBaseAmount === '' || form.wageBaseAmount === null ? null : Number(form.wageBaseAmount),
        customTerms: form.customTerms.filter((c) => c.label && c.value),
      }
      await api.patch(`/rooms/${roomId}/contract`, payload)
      setSaveMessage('저장되었습니다.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSign = async (imageDataUrl) => {
    await api.post(`/rooms/${roomId}/sign`, { imageDataUrl })
    setSigningRole(null)
    await loadAll()
  }

  const handleExportPdf = async () => {
    setExporting(true)
    setError('')
    try {
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

      pdf.save('근로계약서.pdf')
    } catch (err) {
      setError(err.message)
    } finally {
      setExporting(false)
    }
  }

  if (loading) return <p>불러오는 중...</p>
  if (error && !room) return <p className="error">{error}</p>

  return (
    <div className="contract-page">
      <header>
        <Link to={`/rooms/${roomId}`}>← 면접방으로</Link>
        <h1>전자근로계약서</h1>
        <p>{room.title}</p>
      </header>

      {!contractMeta.hireConfirmed && (
        <p className="notice">
          아직 채용이 확정되지 않았습니다. 면접방 채팅에서 "AI로 조건 정리하기"로 채용 확정이 감지된 후 계약서를 작성할
          수 있습니다.
        </p>
      )}

      {contractMeta.hireConfirmed && (
        <>
          {isSigned && <p className="signed-banner">양측 서명이 완료되었습니다.</p>}
          {error && <p className="error">{error}</p>}

          <section className="contract-form">
            <h2>계약 조건 입력/수정</h2>
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
                  <button type="button" onClick={() => removeCustomTerm(idx)}>
                    삭제
                  </button>
                </div>
              ))}
              <button type="button" onClick={addCustomTerm}>
                + 항목 추가
              </button>
            </fieldset>

            {canEdit && (
              <button type="button" onClick={handleSave} disabled={saving}>
                {saving ? '저장 중...' : '저장'}
              </button>
            )}
            {saveMessage && <p className="save-message">{saveMessage}</p>}
          </section>

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
            {!mySignature && (
              <button type="button" onClick={() => setSigningRole(myRole)}>
                서명하기
              </button>
            )}
            {mySignature && !otherSignature && <p>상대방의 서명을 기다리고 있습니다.</p>}
          </section>

          <button type="button" onClick={handleExportPdf} disabled={exporting}>
            {exporting ? 'PDF 생성 중...' : 'PDF 다운로드'}
          </button>
        </>
      )}

      {signingRole && (
        <SignatureModal
          signerLabel={signingRole === 'company' ? '회사' : '지원자'}
          onSave={handleSign}
          onClose={() => setSigningRole(null)}
        />
      )}

      {contractMeta.hireConfirmed && (
        <div className="contract-print" ref={printRef}>
          <h2 className="print-title">표준근로계약서</h2>
          <p>
            {form.employerName || '사업체명 미기재'} (이하 "사업주")과(와) {form.employeeName || '근로자 미기재'}
            (이하 "근로자")은 다음과 같이 근로계약을 체결한다.
          </p>
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
        </div>
      )}
    </div>
  )
}
