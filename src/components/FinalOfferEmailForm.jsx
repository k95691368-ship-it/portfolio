import { useMemo, useState } from 'react'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'

function defaultMessage(candidateName, companyName) {
  return `안녕하세요, ${candidateName}님.

${companyName} 채용 전형 결과, 최종 합격하셨음을 안내드립니다.
함께하게 되어 기쁘며, 입사 일정과 근로계약 관련 세부사항은 면접방에서 이어서 안내드리겠습니다.

축하드립니다.
감사합니다.`
}

// initial: 면접방 화면이 한 번의 요청으로 함께 받아 온 { candidate, delivery }
export default function FinalOfferEmailForm({ roomId, initial, candidateName, companyName }) {
  const defaultSubject = useMemo(() => `[${companyName}] 최종 합격을 축하드립니다`, [companyName])
  const [subject, setSubject] = useState(defaultSubject)
  const [bodyText, setBodyText] = useState(() => defaultMessage(candidateName, companyName))
  const toast = useToast()
  const [sending, setSending] = useState(false)
  // 발송하면 그 결과로 갱신되므로, 받아 온 값을 시작점으로 삼는다.
  const [sentDelivery, setSentDelivery] = useState(null)

  const candidate = initial?.candidate ?? null
  const delivery = sentDelivery ?? initial?.delivery ?? null
  const loading = !initial
  // 서버는 이 값을 내려주고 있었는데 화면이 읽지 않아, 이메일이 설정되지 않은
  // 상태에서도 버튼이 눌리고 503만 돌아왔다. 초대 폼과 같은 방식으로 막는다.
  const emailConfigured = initial?.emailConfigured ?? true
  const setDelivery = setSentDelivery

  const handleSend = async (event) => {
    event.preventDefault()
    if (!window.confirm(`${candidate?.displayName || candidateName}님에게 최종합격 이메일을 보내시겠습니까?`)) {
      return
    }

    setSending(true)
    try {
      const data = await api.post(`/rooms/${roomId}/final-offer-email`, { subject, bodyText })
      setDelivery(data.delivery)
      toast.success('최종합격 이메일을 보냈습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <section className="final-offer-email">
        <h2>최종합격 이메일</h2>
        <p>발송 상태를 불러오는 중...</p>
      </section>
    )
  }

  if (!candidate) {
    return (
      <section className="final-offer-email">
        <h2>최종합격 이메일</h2>
        <p className="notice">지원자가 면접방에 참여하면 최종합격 이메일을 보낼 수 있습니다.</p>
      </section>
    )
  }

  if (delivery?.status === 'sent') {
    return (
      <section className="final-offer-email">
        <h2>최종합격 이메일</h2>
        <p className="save-message">
          {delivery.recipientEmailMasked} 주소로 발송했습니다.
          {delivery.sentAt && ` (${delivery.sentAt})`}
        </p>
        <p className="email-subject-preview">제목: {delivery.subject}</p>
      </section>
    )
  }

  return (
    <section className="final-offer-email">
      <h2>최종합격 이메일</h2>
      <p className="email-recipient">
        받는 사람: {candidate.displayName} ({candidate.emailMasked})
      </p>
      {delivery?.status === 'failed' && (
        <p className="notice">이전 발송이 완료되지 않았습니다. 내용을 확인하고 다시 시도해주세요.</p>
      )}
      {delivery?.status === 'sending' && <p className="notice">현재 이메일을 발송하고 있습니다.</p>}
      {!emailConfigured && (
        <p className="notice">
          이메일 발송 기능이 아직 설정되지 않았습니다. 지원자에게는 앱 알림으로 안내됩니다.
        </p>
      )}
      <form className="final-offer-form" onSubmit={handleSend}>
        <label>
          제목
          <input
            value={subject}
            maxLength={150}
            onChange={(event) => setSubject(event.target.value)}
            required
          />
        </label>
        <label>
          내용
          <textarea
            value={bodyText}
            maxLength={5000}
            onChange={(event) => setBodyText(event.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          className="btn-primary"
          disabled={sending || delivery?.status === 'sending' || !emailConfigured}
        >
          {sending ? '발송 중...' : '최종합격 이메일 보내기'}
        </button>
      </form>
    </section>
  )
}
