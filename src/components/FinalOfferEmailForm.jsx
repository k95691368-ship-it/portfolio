import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [submittedSnapshot, setSubmittedSnapshot] = useState(null)
  const originalDraft = useRef({ subject, bodyText })
  const [sendError, setSendError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const [checking, setChecking] = useState(false)
  const lifecycle = useRef({ active: false, epoch: 0 })
  const pending = useRef(null)
  const checkingRef = useRef(null)
  const uncertainRef = useRef(false)
  const attemptBaseline = useRef(null)
  const ready = useRef(false)
  const deliveryRef = useRef(null)

  const candidate = initial?.candidate ?? null
  const delivery = sentDelivery ?? initial?.delivery ?? null
  const loading = !initial
  // 서버는 이 값을 내려주고 있었는데 화면이 읽지 않아, 이메일이 설정되지 않은
  // 상태에서도 버튼이 눌리고 503만 돌아왔다. 초대 폼과 같은 방식으로 막는다.
  const emailConfigured = initial?.emailConfigured ?? true
  ready.current = !loading && !!candidate && emailConfigured
  deliveryRef.current = delivery
  const blockedStatus = ['sent', 'sending', 'unknown'].includes(delivery?.status)
  const snapshot = submittedSnapshot ?? originalDraft.current
  const changedSinceSubmission = subject !== snapshot.subject || bodyText !== snapshot.bodyText
  const needsCheck = uncertain || ['sending', 'unknown'].includes(delivery?.status)

  useEffect(() => {
    const current = lifecycle.current
    current.active = true
    return () => {
      current.active = false
      current.epoch += 1
      pending.current = null
      checkingRef.current = null
    }
  }, [roomId])

  const validDelivery = (record) => record && ['sent', 'failed', 'sending', 'unknown'].includes(record.status) &&
    typeof record.recipientEmailMasked === 'string' && !!record.recipientEmailMasked && typeof record.subject === 'string' &&
    Number.isInteger(record.attemptCount) && record.attemptCount >= 1

  // This endpoint already has a durable room-level delivery record. Checking
  // it is a GET only; neither a network error nor a click here resends mail.
  const checkDelivery = async () => {
    if (!lifecycle.current.active || pending.current || checkingRef.current) return
    const operation = { epoch: lifecycle.current.epoch }
    checkingRef.current = operation
    const isCurrent = () => lifecycle.current.active && lifecycle.current.epoch === operation.epoch && checkingRef.current === operation
    setChecking(true)
    try {
      const data = await api.get(`/rooms/${roomId}/final-offer-email`)
      if (!isCurrent()) return
      if (!data || !Object.hasOwn(data, 'delivery') || (data.delivery !== null && !validDelivery(data.delivery))) {
        throw new Error('Unverified delivery status')
      }
      const record = data.delivery
      if (!record) {
        setSendError('발송 결과가 아직 확인되지 않았습니다. 보낸메일함과 발송 기록 확인 전에는 재전송하지 마세요.')
        return
      }
      if (deliveryRef.current?.status === 'sent' && record.status !== 'sent') return
      deliveryRef.current = record
      setSentDelivery(record)
      if (record.status === 'sent') {
        uncertainRef.current = false
        setUncertain(false)
        setSendError('')
        toast.info('이메일 서비스의 발송 요청 접수 기록을 확인했습니다. 수신함 도착 확인은 아닙니다.')
      } else if (record.status === 'failed' && (attemptBaseline.current === null || record.attemptCount > attemptBaseline.current)) {
        uncertainRef.current = false
        setUncertain(false)
        setSendError('이번 발송이 완료되지 않은 것으로 확인되었습니다. 내용을 확인한 뒤 직접 다시 요청할 수 있습니다.')
      } else {
        uncertainRef.current = true
        setUncertain(true)
        setSendError('발송 결과를 확인 중입니다. 보낸메일함과 발송 기록 확인 전에는 재전송하지 마세요.')
      }
    } catch {
      if (!isCurrent()) return
      setSendError('발송 상태를 불러오지 못했습니다. 발송 결과 확인만 다시 시도해주세요. 이메일은 다시 보내지 않습니다.')
    } finally {
      if (isCurrent()) { checkingRef.current = null; setChecking(false) }
    }
  }

  const handleSend = async (event) => {
    event.preventDefault()
    if (!lifecycle.current.active || pending.current || checkingRef.current || uncertainRef.current || !ready.current ||
        ['sent', 'sending', 'unknown'].includes(deliveryRef.current?.status)) return
    if (!window.confirm(`${candidate?.displayName || candidateName}님에게 최종합격 이메일을 보내시겠습니까?`)) {
      return
    }

    const operation = { epoch: lifecycle.current.epoch }
    const submitted = { subject, bodyText }
    pending.current = operation
    attemptBaseline.current = deliveryRef.current?.attemptCount ?? 0
    const isCurrent = () => lifecycle.current.active && lifecycle.current.epoch === operation.epoch && pending.current === operation
    setSending(true)
    setSubmittedSnapshot(submitted)
    setSendError('')
    try {
      const data = await api.post(`/rooms/${roomId}/final-offer-email`, submitted)
      if (!isCurrent()) return
      if (data?.ok !== true || !validDelivery(data.delivery) || data.delivery.status !== 'sent') {
        throw new Error('Unverified mail response')
      }
      // The synchronous guard must see the receipt before React renders it.
      deliveryRef.current = data.delivery
      setSentDelivery(data.delivery)
      toast.success('최종합격 이메일 발송 요청이 접수되었습니다.')
    } catch (err) {
      if (!isCurrent()) return
      if (!err?.status || err.status === 408 || err.status === 409 || err.status >= 500) {
        uncertainRef.current = true
        setUncertain(true)
        setSendError('발송 결과를 확인하지 못했습니다. 메일이 발송되었을 수 있으므로 재전송하지 말고 발송 결과를 먼저 확인해주세요.')
      } else {
        setSendError('발송 요청이 거절되었습니다. 입력 내용과 권한을 확인해주세요.')
      }
    } finally {
      if (isCurrent()) { pending.current = null; setSending(false) }
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

  if (delivery?.status === 'sent' && !changedSinceSubmission) {
    return (
      <section className="final-offer-email">
        <h2>최종합격 이메일</h2>
        <p className="save-message">
          {delivery.recipientEmailMasked} 주소로 보낼 발송 요청을 이메일 서비스가 접수했습니다.
          {delivery.sentAt && ` (${delivery.sentAt})`}
        </p>
        <p className="email-subject-preview">제목: {delivery.subject}</p>
        <p className="notice">수신함 도착을 확인한 상태는 아닙니다.</p>
      </section>
    )
  }

  return (
    <section className="final-offer-email">
      <h2>최종합격 이메일</h2>
      <p className="email-recipient">
        받는 사람: {candidate.displayName} ({candidate.emailMasked})
      </p>
      {delivery?.status === 'sent' && <p className="save-message">요청 당시 이메일의 발송 요청이 접수되었습니다. 이후 입력한 내용은 전송되지 않았습니다. 아래 내용을 복사해 보관할 수 있습니다.</p>}
      {delivery?.status === 'sent' && <p className="notice">수신함 도착을 확인한 상태는 아닙니다.</p>}
      {sendError && <p className="error" role="alert">{sendError}</p>}
      {needsCheck && (
        <button type="button" className="btn-sm" disabled={checking || sending} onClick={checkDelivery}>
          {checking ? '발송 결과 확인 중...' : '발송 결과 확인'}
        </button>
      )}
      {delivery?.status === 'failed' && !needsCheck && (
        <p className="notice">이전 발송이 완료되지 않았습니다. 내용을 확인하고 다시 시도해주세요.</p>
      )}
      {delivery?.status === 'sending' && <p className="notice">현재 이메일을 발송하고 있습니다.</p>}
      {delivery?.status === 'unknown' && <p className="notice">메일이 발송되었을 수 있습니다. 운영자가 보낸메일함과 발송 기록을 확인하기 전에는 재전송할 수 없습니다.</p>}
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
            readOnly={delivery?.status === 'sent'}
            maxLength={150}
            onChange={(event) => setSubject(event.target.value)}
            required
          />
        </label>
        <label>
          내용
          <textarea
            value={bodyText}
            readOnly={delivery?.status === 'sent'}
            maxLength={5000}
            onChange={(event) => setBodyText(event.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          className="btn-primary"
          disabled={sending || checking || uncertain || blockedStatus || !emailConfigured}
        >
          {sending ? '발송 중...' : '최종합격 이메일 보내기'}
        </button>
      </form>
    </section>
  )
}
