import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client.js'
import { formatKst } from '../../lib/formatTime.js'

const DEFINITE_WRITE_REJECTIONS = new Set([400, 401, 403, 404, 409, 410, 413, 415, 422, 429])
const SLOT_DURATIONS = new Set([15, 30, 45, 60, 90, 120])
// Keep stored IDs opaque (including older IDs), but never accept an absent or
// malformed identifier as evidence that a scheduling write completed.
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && !/\s/.test(value)
const validTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(value) && Number.isFinite(Date.parse(value))
const validSlot = slot => slot && validId(slot.id) && validTime(slot.startsAt)
  && SLOT_DURATIONS.has(slot.durationMinutes)
  && typeof slot.recordingRequired === 'boolean' && typeof slot.available === 'boolean'
function confirmsBooking(response, roomId, selectedSlot, existingSessionId) {
  const next = response?.session
  return next && validId(next.id) && (!existingSessionId || next.id === existingSessionId)
    && next.roomId === roomId && next.bookingSlotId === selectedSlot.id
    && validTime(next.scheduledAt) && Date.parse(next.scheduledAt) === Date.parse(selectedSlot.startsAt)
    && next.durationMinutes === selectedSlot.durationMinutes && next.recordingRequired === selectedSlot.recordingRequired
}

export default function InterviewSlotPicker({ roomId, isCompany, session, disabled, writeLocked = false, onChanged }) {
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [readUncertain, setReadUncertain] = useState(true)
  const [notice, setNotice] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [duration, setDuration] = useState(30)
  const [recording, setRecording] = useState(true)
  const [selected, setSelected] = useState('')
  const requestKey = useRef('')
  const lifetime = useRef(null)
  const generation = useRef(0)
  const pendingWrite = useRef(null)
  const readUncertainRef = useRef(true)
  const needsParentSync = useRef(false)
  const unknownWrite = useRef(false)
  const changedRef = useRef(onChanged)
  changedRef.current = onChanged
  const actionsLockedRef = useRef(disabled || writeLocked)
  actionsLockedRef.current = disabled || writeLocked
  const base = `/rooms/${roomId}/interview-slots`
  useEffect(() => {
    const scope = {}
    lifetime.current = scope
    return () => {
      if (lifetime.current === scope) lifetime.current = null
      generation.current += 1
      pendingWrite.current = null
    }
  }, [base])
  const load = useCallback(async () => {
    const scope = lifetime.current
    if (!scope) return null
    const request = ++generation.current
    const current = () => lifetime.current === scope && generation.current === request
    setLoading(true)
    setReadError('')
    readUncertainRef.current = true
    setReadUncertain(true)
    try {
      if (needsParentSync.current) {
        await changedRef.current?.()
        if (!current()) return null
        needsParentSync.current = false
      }
      const data = await api.get(base)
      if (!current()) return null
      if (!Array.isArray(data?.slots) || !data.slots.every(validSlot)) {
        throw new Error('가능한 시간 응답을 확인하지 못했습니다.')
      }
      setSlots(data.slots)
      readUncertainRef.current = false
      setReadUncertain(false)
      if (unknownWrite.current) {
        unknownWrite.current = false
        requestKey.current = ''
        setNotice('최신 면접 시간을 다시 확인했습니다.')
      }
      return data.slots
    } catch (err) {
      if (!current()) return null
      setReadError(err?.message || '가능한 시간을 불러오지 못했습니다.')
      readUncertainRef.current = true
      setReadUncertain(true)
      throw err
    } finally { if (current()) setLoading(false) }
  }, [base])
  useEffect(() => { void load().catch(() => {}) }, [load, session?.id, session?.scheduledAt, session?.status])
  const active = session && ['scheduled', 'waiting', 'live'].includes(session.status)
  const canBook = !disabled && (!active || (session.bookingSlotId && ['scheduled', 'waiting'].includes(session.status) && !session.members?.some(member => member.admittedAt || member.joinedAt)))
  const available = slots.filter(slot => slot.available && (!active || slot.recordingRequired === session.recordingRequired))
  const controlsLocked = disabled || writeLocked || readUncertain
  const run = async (action, confirmsResponse, onConfirmed = () => {}, success = '변경은 저장되었습니다.') => {
    if (!lifetime.current || pendingWrite.current || readUncertainRef.current || actionsLockedRef.current) return
    const ticket = { scope: lifetime.current }
    pendingWrite.current = ticket
    const current = () => lifetime.current === ticket.scope && pendingWrite.current === ticket
    const submittedSelection = selected
    generation.current += 1
    setLoading(false)
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await action()
      if (!current()) return
      // A 2xx with a missing/unrelated body is still an unknown outcome: retain
      // the draft and use GET recovery, never a success notice or blind resend.
      if (!confirmsResponse(response)) throw new Error('처리 결과 응답을 확인하지 못했습니다.')
      onConfirmed()
      setSelected(value => value === submittedSelection ? '' : value)
      requestKey.current = ''
      setNotice(success)
      needsParentSync.current = true
      // The mutation has succeeded. Follow-up failures belong to GET recovery,
      // not to resubmitting the already stored time or reservation.
      await load().catch(() => {})
    } catch (err) {
      if (!current()) return
      if (DEFINITE_WRITE_REJECTIONS.has(err?.status)) {
        requestKey.current = ''
        setError(err.message)
      } else {
        generation.current += 1
        readUncertainRef.current = true
        setReadUncertain(true)
        unknownWrite.current = true
        needsParentSync.current = true
        setReadError('처리 결과를 확인하지 못했습니다. 같은 작업을 다시 보내지 말고 새로고침으로 확인해주세요.')
      }
    } finally { if (current()) { pendingWrite.current = null; setBusy(false) } }
  }
  const add = event => {
    event.preventDefault()
    const submittedTime = startsAt
    void run(
      () => api.post(base, { startsAt: `${submittedTime}:00+09:00`, durationMinutes: duration, recordingRequired: recording }),
      response => validId(response?.id),
      () => setStartsAt(value => value === submittedTime ? '' : value),
      '시간은 등록되었습니다.'
    )
  }
  const book = event => {
    event.preventDefault()
    if (actionsLockedRef.current || readUncertainRef.current || pendingWrite.current) return
    const selectedSlot = available.find(slot => slot.id === selected)
    if (!selectedSlot) { setError('선택할 시간을 확인해주세요.'); return }
    if (!requestKey.current) requestKey.current = crypto.randomUUID()
    const existingSessionId = active ? session.id : null
    void run(
      () => existingSessionId
        ? api.patch(`/rooms/${roomId}/interviews/${existingSessionId}`, { slotId: selectedSlot.id })
        : api.post(`/rooms/${roomId}/interviews`, { slotId: selectedSlot.id, clientRequestId: requestKey.current }),
      response => confirmsBooking(response, roomId, selectedSlot, existingSessionId)
    )
  }
  if (disabled) return null
  return <section className="interview-slot-picker" aria-label="면접 시간 선택">
    <div className="interview-member-manager__heading"><h3>{isCompany ? '선택 가능한 시간' : '면접 시간 선택'}</h3><button type="button" className="interview-text-button" disabled={busy || loading} onClick={() => { setError(''); void load().catch(() => {}) }}>새로고침</button></div>
    {error && <p className="interview-inline-error" role="alert">{error}</p>}
    {notice && <p className="interview-panel-status" role="status">{notice}</p>}
    {readError && <p className="interview-inline-error" role="alert">{readError} 최신 상태 확인 전까지 추가 작업이 잠깁니다. 새로고침은 조회만 다시 실행합니다.</p>}
    {loading && <p role="status">가능한 시간을 불러오는 중입니다.</p>}
    {isCompany ? <>
      <p className="interview-panel-status">등록한 시간은 담당자의 모든 면접방에서 지원자가 선택할 수 있습니다. 이미 예약된 시간은 선택할 수 없습니다.</p>
      <details><summary>시간 등록·관리</summary>
        <form className="interview-session-form" onSubmit={add}>
          <label><span>시작 시간 (한국 시간)</span><input type="datetime-local" disabled={controlsLocked} value={startsAt} min={formatKst(new Date().toISOString()).replace(' ', 'T')} onChange={event => setStartsAt(event.target.value)} required /></label>
          <label><span>소요 시간</span><select disabled={controlsLocked} value={duration} onChange={event => setDuration(Number(event.target.value))}>{[15,30,45,60,90,120].map(minutes => <option key={minutes} value={minutes}>{minutes}분</option>)}</select></label>
          <label className="interview-recording-option"><input type="checkbox" disabled={controlsLocked} checked={recording} onChange={event => setRecording(event.target.checked)} /><span>녹화 동의 필수</span></label>
          <button type="submit" disabled={controlsLocked || busy} className="interview-primary-button">{busy ? '처리 중…' : '시간 등록'}</button>
        </form>
        <ul className="interview-member-list">{slots.map(slot => <li key={slot.id}><span>{formatKst(slot.startsAt)} · {slot.durationMinutes}분 · {slot.recordingRequired ? '녹화 동의 필수' : '녹화 없음'} · {slot.available ? '예약 가능' : '예약 불가'}</span><button type="button" disabled={controlsLocked || busy || !slot.available} onClick={() => { if (!actionsLockedRef.current && !readUncertainRef.current && !pendingWrite.current && window.confirm('이 시간을 선택 목록에서 철회하시겠습니까?')) void run(() => api.delete(base, { id: slot.id }), response => response?.withdrawn === true) }}>철회</button></li>)}</ul>
      </details>
    </> : canBook ? <form className="interview-session-form" onSubmit={book}>
      <label><span>{active ? '변경할 시간 (한국 시간)' : '가능한 시간 (한국 시간)'}</span><select value={selected} onChange={event => { setSelected(event.target.value); requestKey.current = '' }} required disabled={controlsLocked || busy || loading}><option value="">시간을 선택해주세요</option>{available.map(slot => <option key={slot.id} value={slot.id}>{formatKst(slot.startsAt)} · {slot.durationMinutes}분 · {slot.recordingRequired ? '녹화 동의 필수' : '녹화 없음'}</option>)}</select></label>
      {!loading && !readError && !available.length && <p className="interview-panel-status">현재 선택 가능한 시간이 없습니다. 담당자에게 시간 등록을 요청해주세요.</p>}
      <button type="submit" className="interview-primary-button" disabled={controlsLocked || busy || loading || !selected}>{busy ? '처리 중…' : active ? '선택한 시간으로 변경' : '선택한 시간으로 예약'}</button>
      {active && <p className="interview-panel-status">새 시간 예약에 성공한 경우에만 기존 예약 시간이 해제됩니다.</p>}
    </form> : <p className="interview-panel-status">현재 일정은 아래에서 확인해주세요.</p>}
  </section>
}
