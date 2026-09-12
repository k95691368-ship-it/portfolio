import { useId, useRef, useState } from 'react'
import { POSTING_EMOJIS, insertPostingText } from '../../shared/jobPostingTemplate.js'
import PostingDescription from './PostingDescription.jsx'

export default function PostingEditor({ value, onChange, onLoadExample }) {
  const id = useId()
  const textarea = useRef(null)
  const selection = useRef({ start: value.length, end: value.length })
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState('')
  const capture = () => {
    selection.current = { start: textarea.current.selectionStart, end: textarea.current.selectionEnd }
  }
  const insert = (emoji) => {
    const next = insertPostingText(value, emoji, selection.current.start, selection.current.end)
    if (next.value.length > 20000) { setError('공고 내용은 20,000자 이내로 입력해주세요.'); return }
    onChange(next.value)
    setOpen(false)
    setError('')
    selection.current = { start: next.cursor, end: next.cursor }
    requestAnimationFrame(() => {
      textarea.current?.focus()
      textarea.current?.setSelectionRange(next.cursor, next.cursor)
    })
  }
  return <div className="posting-editor">
    <label htmlFor={id}>상세 내용 <span className="consent-required" aria-hidden="true">*</span></label>
    <div className="posting-editor-toolbar">
      <button type="button" className="btn-sm" aria-expanded={open} aria-controls={`${id}-emojis`}
        onClick={() => setOpen(!open)}>이모티콘 넣기</button>
      <button type="button" className="btn-sm" onClick={onLoadExample}>예시 공고문 불러오기</button>
      <button type="button" className="btn-sm" aria-pressed={preview}
        onClick={() => setPreview(!preview)}>{preview ? '미리보기 닫기' : '미리보기'}</button>
    </div>
    {open && <div className="posting-emoji-picker" id={`${id}-emojis`} role="group" aria-label="공고 이모티콘"
      onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); textarea.current?.focus() } }}>
      {POSTING_EMOJIS.map(([emoji, label]) => <button type="button" key={emoji} title={label}
        aria-label={`${label} ${emoji} 넣기`} onClick={() => insert(emoji)}>{emoji}</button>)}
    </div>}
    <textarea ref={textarea} id={id} value={value} rows={18} required maxLength={20000}
      onChange={(e) => { onChange(e.target.value); setError('') }} onSelect={capture} onBlur={capture} />
    {error && <p role="alert" className="error">{error}</p>}
    {preview && <section className="posting-preview" aria-label="공고 미리보기"><PostingDescription value={value} /></section>}
  </div>
}
