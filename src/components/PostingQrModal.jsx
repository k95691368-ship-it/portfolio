import { useEffect, useState } from 'react'
import Modal from './Modal.jsx'
import { generatePostingQr, postingApplicationUrl } from '../lib/postingShare.js'

export default function PostingQrModal({ posting, onClose }) {
  const [image, setImage] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const url = postingApplicationUrl(window.location.origin, posting.id)
  useEffect(() => {
    let live = true
    generatePostingQr(url).then(value => { if (live) setImage(value) }).catch(() => { if (live) setError('QR 코드를 만들지 못했습니다. 닫은 뒤 다시 시도해주세요.') })
    return () => { live = false }
  }, [url])
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true) }
    catch { setError('복사하지 못했습니다. 아래 주소를 직접 복사해주세요.') }
  }
  return <Modal title="지원 페이지 QR 코드" onClose={onClose}>
    <div className="modal-head"><h2>지원 페이지 QR 코드</h2><button type="button" className="btn-ghost btn-sm" onClick={onClose}>닫기</button></div>
    <p>{posting.title}</p>
    {image ? <img src={image} alt={`${posting.title} 지원 페이지 QR 코드`} width="280" height="280" style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '20px auto' }} /> : !error && <p role="status">QR 코드를 만드는 중입니다.</p>}
    {error && <p role="alert">{error}</p>}
    <label>지원 주소<input readOnly value={url} onFocus={event => event.target.select()} /></label>
    <p className="notice">공고가 마감되거나 삭제되면 이 QR 코드로 지원할 수 없습니다.</p>
    <div className="modal-actions">
      <button type="button" onClick={copy}>{copied ? '복사됨' : '주소 복사'}</button>
      {image && <a className="btn-nav" href={image} download={`job-${posting.id}-qr.png`}>QR 이미지 저장</a>}
    </div>
  </Modal>
}
