import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client.js'

function defaultMessage(candidateName, companyName) {
  return `안녕하세요, ${candidateName}님.

${companyName} 채용 담당자입니다. 면접 진행을 위해 면접방으로 참여를 요청드립니다.
지원 시 사용하신 이메일로 발급된 계정으로 로그인하신 뒤, 대시보드에서 면접방에 입장해 주세요.

감사합니다.`
}

export default function RoomInviteEmailForm({ roomId, candidateName, companyName }) {
  const defaultSubject = useMemo(() => `[${companyName}] 면접방 참여 안내`, [companyName])
  const [subject, setSubject] = useState(defaultSubject)
  const [bodyText, setBodyText] = useState(() => defaultMessage(candidateName, companyName))
  const [candidate, setCandidate] = useState(null)
  const [emailConfigured, setEmailConfigured] = useState(true)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState('')

  useEffect(() => {
    api
      .get(`/rooms/${roomId}/invite-email`)
      .then((data) => {
        setCandidate(data.candidate)
        setEmailConfigured(data.emailConfigured)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [roomId])

  const handleSend = async (event) => {
    event.preventDefault()
    if (!window.confirm(`${candidate?.displayName || candidateName}님에게 면접방 초대 이메일을 보내시겠습니까?`)) {
      return
    }
    setError('')
    setSending(true)
    try {
      const data = await api.post(`/rooms/${roomId}/invite-email`, { subject, bodyText })
      setSentTo(data.recipientEmailMasked)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
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
          이메일 발송 기능이 아직 설정되지 않았습니다. (RESEND_API_KEY 설정 후 사용 가능)
        </p>
      )}
      {sentTo && <p className="save-message">{sentTo} 주소로 초대 이메일을 보냈습니다.</p>}
      {error && <p className="error">{error}</p>}
      <form className="final-offer-form" onSubmit={handleSend}>
        <label>
          제목
          <input value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} required />
        </label>
        <label>
          내용
          <textarea value={bodyText} maxLength={5000} rows={7} onChange={(e) => setBodyText(e.target.value)} required />
        </label>
        <button type="submit" className="btn-primary" disabled={sending || !emailConfigured}>
          {sending ? '발송 중...' : '면접방 초대 이메일 보내기'}
        </button>
      </form>
    </section>
  )
}
