import { useRef, useState } from 'react'
import SignaturePad from './SignaturePad.jsx'
import Modal from './Modal.jsx'

export default function SignatureModal({ signerLabel, onSave, onClose }) {
  const padRef = useRef(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [typedName, setTypedName] = useState('')

  const handleClear = () => {
    padRef.current?.clear()
    setTypedName('')
    setError('')
  }

  // 이름을 입력하면 그것이 곧 서명이 된다. 마우스를 쓸 수 없는 사람에게
  // 유일한 경로이므로, 입력할 때마다 캔버스에 바로 반영해 무엇이 서명으로
  // 남는지 눈으로 확인할 수 있게 한다.
  const handleTypedName = (value) => {
    setTypedName(value)
    padRef.current?.setTypedName(value)
    if (value) setError('')
  }

  const handleSave = async () => {
    if (padRef.current?.isEmpty()) {
      setError('서명을 그리거나 이름을 입력해주세요.')
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
    <Modal title={`${signerLabel} 서명`} onClose={onClose}>
      <h3>{signerLabel} 서명</h3>
      <p>아래 칸에 서명하시거나, 이름을 입력해 서명하실 수 있습니다.</p>
      <SignaturePad ref={padRef} />

      <label className="signature-typed">
        이름으로 서명
        <input
          type="text"
          value={typedName}
          onChange={(e) => handleTypedName(e.target.value)}
          placeholder="이름을 입력하면 위 칸에 서명으로 표시됩니다"
          maxLength={30}
          autoComplete="name"
          disabled={saving}
        />
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" onClick={handleClear} disabled={saving}>
          지우기
        </button>
        <button type="button" onClick={onClose} disabled={saving}>
          취소
        </button>
        <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? '저장 중...' : '서명 완료'}
        </button>
      </div>
    </Modal>
  )
}
