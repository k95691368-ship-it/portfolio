import { useRef, useState } from 'react'
import SignaturePad from './SignaturePad.jsx'

export default function SignatureModal({ signerLabel, onSave, onClose }) {
  const padRef = useRef(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleClear = () => {
    padRef.current?.clear()
    setError('')
  }

  const handleSave = async () => {
    if (padRef.current?.isEmpty()) {
      setError('서명을 그려주세요.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(padRef.current.toDataURL())
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>{signerLabel} 서명</h3>
        <p>아래 칸에 마우스로 서명해주세요.</p>
        <SignaturePad ref={padRef} />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={handleClear} disabled={saving}>
            다시 그리기
          </button>
          <button type="button" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : '서명 완료'}
          </button>
        </div>
      </div>
    </div>
  )
}
