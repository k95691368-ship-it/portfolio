import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client.js'
import { formatKst } from '../../lib/formatTime.js'

export default function InterviewSlotPicker({ roomId, isCompany, session, disabled, onChanged }) {
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [duration, setDuration] = useState(30)
  const [recording, setRecording] = useState(true)
  const [selected, setSelected] = useState('')
  const requestKey = useRef('')
  const base = `/rooms/${roomId}/interview-slots`
  const load = useCallback(async () => {
    setLoading(true)
    try { setSlots((await api.get(base)).slots) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [base])
  useEffect(() => { void load() }, [load, session?.id, session?.scheduledAt, session?.status])
  const active = session && ['scheduled', 'waiting', 'live'].includes(session.status)
  const canBook = !disabled && (!active || (session.bookingSlotId && ['scheduled', 'waiting'].includes(session.status) && !session.members?.some(member => member.admittedAt || member.joinedAt)))
  const available = slots.filter(slot => slot.available && (!active || slot.recordingRequired === session.recordingRequired))
  const run = async action => {
    if (busy || disabled) return
    setBusy(true); setError('')
    try { await action(); setSelected(''); await onChanged(); await load() }
    catch (err) { setError(err.message); await load() }
    finally { setBusy(false) }
  }
  const add = event => {
    event.preventDefault()
    void run(async () => {
      await api.post(base, { startsAt: `${startsAt}:00+09:00`, durationMinutes: duration, recordingRequired: recording })
      setStartsAt('')
    })
  }
  const book = event => {
    event.preventDefault()
    if (!available.some(slot => slot.id === selected)) { setError('선택할 시간을 확인해주세요.'); return }
    if (!requestKey.current) requestKey.current = crypto.randomUUID()
    void run(() => active
      ? api.patch(`/rooms/${roomId}/interviews/${session.id}`, { slotId: selected })
      : api.post(`/rooms/${roomId}/interviews`, { slotId: selected, clientRequestId: requestKey.current }))
  }
  if (disabled) return null
  return <section className="interview-slot-picker" aria-label="면접 시간 선택">
    <div className="interview-member-manager__heading"><h3>{isCompany ? '선택 가능한 시간' : '면접 시간 선택'}</h3><button type="button" className="interview-text-button" disabled={busy || loading} onClick={() => { setError(''); void load() }}>새로고침</button></div>
    {error && <p className="interview-inline-error" role="alert">{error}</p>}
    {loading && <p role="status">가능한 시간을 불러오는 중입니다.</p>}
    {isCompany ? <>
      <p className="interview-panel-status">등록한 시간은 담당자의 모든 면접방에서 지원자가 선택할 수 있습니다. 이미 예약된 시간은 선택할 수 없습니다.</p>
      <details><summary>시간 등록·관리</summary>
        <form className="interview-session-form" onSubmit={add}>
          <label><span>시작 시간 (한국 시간)</span><input type="datetime-local" value={startsAt} min={formatKst(new Date().toISOString()).replace(' ', 'T')} onChange={event => setStartsAt(event.target.value)} required /></label>
          <label><span>소요 시간</span><select value={duration} onChange={event => setDuration(Number(event.target.value))}>{[15,30,45,60,90,120].map(minutes => <option key={minutes} value={minutes}>{minutes}분</option>)}</select></label>
          <label className="interview-recording-option"><input type="checkbox" checked={recording} onChange={event => setRecording(event.target.checked)} /><span>녹화 동의 필수</span></label>
          <button type="submit" disabled={busy} className="interview-primary-button">{busy ? '처리 중…' : '시간 등록'}</button>
        </form>
        <ul className="interview-member-list">{slots.map(slot => <li key={slot.id}><span>{formatKst(slot.startsAt)} · {slot.durationMinutes}분 · {slot.recordingRequired ? '녹화 동의 필수' : '녹화 없음'} · {slot.available ? '예약 가능' : '예약 불가'}</span><button type="button" disabled={busy || !slot.available} onClick={() => { if (window.confirm('이 시간을 선택 목록에서 철회하시겠습니까?')) void run(() => api.delete(base, { id: slot.id })) }}>철회</button></li>)}</ul>
      </details>
    </> : canBook ? <form className="interview-session-form" onSubmit={book}>
      <label><span>{active ? '변경할 시간 (한국 시간)' : '가능한 시간 (한국 시간)'}</span><select value={selected} onChange={event => { setSelected(event.target.value); requestKey.current = '' }} required disabled={busy || loading}><option value="">시간을 선택해주세요</option>{available.map(slot => <option key={slot.id} value={slot.id}>{formatKst(slot.startsAt)} · {slot.durationMinutes}분 · {slot.recordingRequired ? '녹화 동의 필수' : '녹화 없음'}</option>)}</select></label>
      {!loading && !available.length && <p className="interview-panel-status">현재 선택 가능한 시간이 없습니다. 담당자에게 시간 등록을 요청해주세요.</p>}
      <button type="submit" className="interview-primary-button" disabled={busy || loading || !selected}>{busy ? '처리 중…' : active ? '선택한 시간으로 변경' : '선택한 시간으로 예약'}</button>
      {active && <p className="interview-panel-status">새 시간 예약에 성공한 경우에만 기존 예약 시간이 해제됩니다.</p>}
    </form> : <p className="interview-panel-status">현재 일정은 아래에서 확인해주세요.</p>}
  </section>
}
