import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'

function defaultMessage(candidateName, companyName) {
  return `안녕하세요, ${candidateName}님.

${companyName} 채용 담당자입니다. 면접 진행을 위해 면접방으로 참여를 요청드립니다.
지원 시 사용하신 이메일로 발급된 계정으로 로그인하신 뒤, 대시보드에서 면접방에 입장해 주세요.

감사합니다.`
}

// initial: 면접방 화면이 한 번의 요청으로 함께 받아 온 { candidate, emailConfigured }
export default function RoomInviteEmailForm({ roomId, initial, candidateName, companyName }) {
  const defaultSubject = useMemo(() => `[${companyName}] 면접방 참여 안내`, [companyName])
  const [subject, setSubject] = useState(defaultSubject)
  const [bodyText, setBodyText] = useState(() => defaultMessage(candidateName, companyName))
  const toast = useToast()
  const [sending, setSending] = useState(false)
  const [sentTo, setSentTo] = useState('')
  const [sentSnapshot, setSentSnapshot] = useState(null)
  const [sendError, setSendError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const lifecycle = useRef({ active: false, epoch: 0 })
  const pending = useRef(null)
  const uncertainRef = useRef(false)
  const ready = useRef(false)

  const candidate = initial?.candidate ?? null
  const emailConfigured = initial?.emailConfigured ?? true
  const loading = !initial
  ready.current = !loading && !!candidate && emailConfigured
  const changedSinceSend = sentSnapshot && (subject !== sentSnapshot.subject || bodyText !== sentSnapshot.bodyText)

  useEffect(() => {
    const current = lifecycle.current
    current.active = true
    return () => { current.active = false; current.epoch += 1; pending.current = null }
  }, [roomId])

  const handleSend = async (event) => {
    event.preventDefault()
    if (!lifecycle.current.active || pending.current || uncertainRef.current || !ready.current) return
    if (!window.confirm(`${candidate?.displayName || candidateName}님에게 면접방 초대 이메일을 보내시겠습니까?`)) {
      return
    }
    const operation = { epoch: lifecycle.current.epoch }
    const submitted = { subject, bodyText }
    pending.current = operation
    const isCurrent = () => lifecycle.current.active && lifecycle.current.epoch === operation.epoch && pending.current === operation
    setSending(true)
    setSendError('')
    try {
      const data = await api.post(`/rooms/${roomId}/invite-email`, submitted)
      if (!isCurrent()) return
      if (data?.ok !== true || typeof data.recipientEmailMasked !== 'string' || !data.recipientEmailMasked) {
        throw new Error('Unverified mail response')
      }
      setSentTo(data.recipientEmailMasked)
      setSentSnapshot(submitted)
      toast.success('면접방 초대 이메일 발송 요청이 접수되었습니다.')
    } catch (err) {
      if (!isCurrent()) return
      if (!err?.status || err.status === 408 || err.status === 409 || err.status >= 500) {
        uncertainRef.current = true
        setUncertain(true)
        setSendError('발송 결과를 확인하지 못했습니다. 메일이 발송되었을 수 있으므로 운영자가 보낸메일함과 발송 기록을 확인하기 전에는 재전송하지 마세요.')
      } else {
        setSendError('발송 요청이 거절되었습니다. 입력 내용과 권한을 확인해주세요.')
      }
    } finally {
      if (isCurrent()) { pending.current = null; setSending(false) }
    }
  }

  if (loading) return null
  if (!candidate) {
    return (
      <section className="room-invite-email">
        <h2>면접방 초대</h2>
        <p className="notice">지원자가 면접방에 연결되면 초대 이메일을 보낼 수 있습니다.</p>
      </section>
    )
  }

  return (
    <section className="room-invite-email">
      <h2>면접방 초대 이메일</h2>
      <p className="email-recipient">
        받는 사람: {candidate.displayName} ({candidate.emailMasked})
      </p>
      {!emailConfigured && (
        <p className="notice">
          이메일 발송 기능이 아직 설정되지 않았습니다. 관리자에게 발송 설정을 확인해주세요.
        </p>
      )}
      {sentTo && <p className="save-message">{sentTo} 주소로 보낼 초대 이메일 요청을 이메일 서비스가 접수했습니다. 수신함 도착을 확인한 상태는 아닙니다.</p>}
      {changedSinceSend && <p className="notice" role="status">발송 요청 당시 내용만 접수됐습니다. 이후 입력한 내용은 전송되지 않았습니다.</p>}
      {sendError && <p className="error" role="alert">{sendError}</p>}
      <form className="final-offer-form" onSubmit={handleSend}>
        <label>
          제목
          <input value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} required />
        </label>
        <label>
          내용
          <textarea value={bodyText} maxLength={5000} rows={7} onChange={(e) => setBodyText(e.target.value)} required />
        </label>
        <button type="submit" className="btn-primary" disabled={sending || uncertain || !emailConfigured}>
          {sending ? '발송 중...' : '면접방 초대 이메일 보내기'}
        </button>
      </form>
    </section>
  )
}
