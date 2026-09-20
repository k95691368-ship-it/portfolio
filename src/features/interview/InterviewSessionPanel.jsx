import { useCallback, useEffect, useRef, useState } from 'react'
import { api, roomDoorFor } from '../../api/client.js'
import {
  formatScheduledAt,
  interviewPagePath,
  interviewerPagePath,
  isClosedInterviewStatus,
  latestSession,
  normalizeSession,
  recordingFilePath,
  toScheduledIso,
} from './sessionModel.js'
import './interview.css'
import InterviewSlotPicker from './InterviewSlotPicker.jsx'

const DEFINITE_WRITE_REJECTIONS = new Set([400, 401, 403, 404, 409, 410, 413, 415, 422, 429])
const usableSession = value => value && typeof value.id === 'string' && value.id && typeof value.title === 'string'

function formatRetentionDate(value) {
  if (!value) return ''
  const normalized = String(value).replace(' ', 'T')
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

function RecordingResult({ roomId, session, onRecordingChanged, writeLocked = false }) {
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [fileError, setFileError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const writeLockedRef = useRef(writeLocked)
  writeLockedRef.current = writeLocked
  const recording = session?.recording
  const expired = recording?.expired || recording?.status === 'deleted'
  const storageFailed = recording?.storageStatus === 'copy_failed'
  const canPlay = Boolean(
    recording?.status === 'available' &&
      recording.available !== false &&
      !expired &&
      !storageFailed &&
      (!recording.storageStatus || recording.storageStatus === 'stored')
  )
  const retentionDate = formatRetentionDate(recording.retentionUntil)

  let detail = recording.label
  if (recording.status === 'deleted') detail = '녹화 파일 삭제가 완료되었습니다.'
  else if (expired) detail = '보관 기간이 만료되어 재생할 수 없습니다. 저장 파일은 삭제 대기 중입니다.'
  else if (recording.status === 'processing' || recording.storageStatus === 'copying') {
    detail = '녹화 파일을 처리하는 중입니다.'
  } else if (recording.status === 'failed' || storageFailed) {
    detail = '녹화 파일을 준비하지 못했습니다.'
  } else if (recording.status === 'available' && !canPlay) {
    detail = '녹화 파일을 보관하는 중입니다.'
  }

  const selectedDoor = roomDoorFor(roomId)
  const identity = selectedDoor === 'code' || selectedDoor === 'account' ? selectedDoor : ''
  const filePath = recording?.id
    ? recordingFilePath(roomId, session.id, recording.id, false, identity)
    : ''

  useEffect(() => {
    if (!canPlay || !filePath) {
      setVideoUrl('')
      return undefined
    }
    let current = true
    const separator = filePath.includes('?') ? '&' : '?'
    void api.get(`${filePath}${separator}signed=1`)
      .then((response) => {
        if (current) setVideoUrl(response?.url || '')
      })
      .catch((caught) => {
        if (current) setFileError(caught.message)
      })
    return () => {
      current = false
    }
  }, [canPlay, filePath])

  if (!recording?.id || recording.status === 'idle') return null

  const retryStorage = async () => {
    if (writeLockedRef.current || !recording?.id || retrying) return
    setRetrying(true)
    setRetryError('')
    try {
      const response = await api.post(
        `/rooms/${roomId}/interviews/${session.id}/recordings/${recording.id}/retry`,
        {}
      )
      onRecordingChanged?.(response?.recording)
    } catch (error) {
      setRetryError(error.message)
    } finally {
      setRetrying(false)
    }
  }

  const downloadRecording = async () => {
    if (!filePath || downloading) return
    setDownloading(true)
    setFileError('')
    try {
      const separator = filePath.includes('?') ? '&' : '?'
      const response = await api.get(`${filePath}${separator}signed=1&download=1`)
      if (!response?.url) throw new Error('녹화 파일 주소를 받지 못했습니다.')
      window.location.assign(response.url)
    } catch (caught) {
      setFileError(caught.message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <section className="interview-recording-result" aria-label="최근 녹화">
      <div className="interview-recording-result__heading">
        <div>
          <span>최근 녹화</span>
          <strong>{detail}</strong>
        </div>
        {retentionDate && !expired && <small>{retentionDate}까지 보관</small>}
      </div>
      {canPlay && (
        <>
          {videoUrl ? (
            <video controls preload="metadata" src={videoUrl}>
              이 브라우저에서는 녹화 영상을 재생할 수 없습니다.
            </video>
          ) : (
            <p className="interview-panel-status">녹화 영상을 불러오는 중입니다.</p>
          )}
          <button
            type="button"
            className="interview-recording-download"
            disabled={downloading}
            onClick={() => void downloadRecording()}
          >
            {downloading ? '다운로드 준비 중…' : '녹화 파일 다운로드'}
          </button>
        </>
      )}
      {fileError && <p className="interview-member-error" role="alert">{fileError}</p>}
      {storageFailed && session.myRole === 'host' && (
        <div className="interview-recording-retry">
          <button type="button" disabled={writeLocked || retrying} onClick={retryStorage}>
            {retrying ? '보관 확인 중…' : '녹화 보관 다시 확인'}
          </button>
          {retryError && <p role="alert">{retryError}</p>}
        </div>
      )}
    </section>
  )
}

export default function InterviewSessionPanel({
  roomId,
  roomTitle = '',
  myRole,
  disabled = false,
  writeLocked = false,
}) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [readUncertain, setReadUncertain] = useState(true)
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState(roomTitle ? `${roomTitle} 화상 면접` : '화상 면접')
  const [scheduledAt, setScheduledAt] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [recordingRequired, setRecordingRequired] = useState(true)
  const [memberEmail, setMemberEmail] = useState('')
  const [memberBusy, setMemberBusy] = useState('')
  const [memberError, setMemberError] = useState('')
  const [copyState, setCopyState] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const createRequestIdRef = useRef('')
  const lifetime = useRef(null)
  const readGeneration = useRef(0)
  const readUncertainRef = useRef(true)
  const pendingWrite = useRef(null)
  const unknownWrite = useRef(false)
  const unknownCreateVersion = useRef(null)
  const draftVersion = useRef(0)
  // Archival closes the workflow; a transient room refresh only pauses it.
  // Keep form DOM/state mounted, but captured handlers must see the latest lock.
  const actionsLockedRef = useRef(disabled || writeLocked)
  actionsLockedRef.current = disabled || writeLocked

  const isCompany = myRole === 'company'

  const loadSessions = useCallback(async ({ knownSession } = {}) => {
    const scope = lifetime.current
    if (!scope) return null
    const generation = ++readGeneration.current
    const current = () => lifetime.current === scope && readGeneration.current === generation
    setLoading(true)
    setReadError('')
    readUncertainRef.current = true
    setReadUncertain(true)
    try {
      let summary = knownSession
      if (!summary) {
        const data = await api.get(`/rooms/${roomId}/interviews`)
        if (!current()) return null
        if (!Array.isArray(data?.sessions) || !data.sessions.every(row => usableSession(normalizeSession(row)))) {
          throw new Error('일정 목록 응답을 확인하지 못했습니다.')
        }
        summary = latestSession(data)
      }
      let next = null
      if (summary) {
        if (!usableSession(summary)) throw new Error('일정 응답을 확인하지 못했습니다.')
        next = normalizeSession(await api.get(`/rooms/${roomId}/interviews/${summary.id}`))
        if (!current()) return null
        if (!usableSession(next) || next.id !== summary.id) throw new Error('일정 상세 응답을 확인하지 못했습니다.')
      }
      if (!current()) return null
      setSession(next)
      setHasLoaded(true)
      setReadError('')
      readUncertainRef.current = false
      setReadUncertain(false)
      if (unknownWrite.current) {
        unknownWrite.current = false
        createRequestIdRef.current = ''
        if (next && unknownCreateVersion.current !== null && draftVersion.current === unknownCreateVersion.current) setFormOpen(false)
        unknownCreateVersion.current = null
        setNotice('최신 일정을 다시 확인했습니다.')
      }
      if (!next && isCompany) setFormOpen(true)
      return next
    } catch (err) {
      if (!current()) return null
      setReadError(err?.message || '일정을 불러오지 못했습니다.')
      readUncertainRef.current = true
      setReadUncertain(true)
      throw err
    } finally {
      if (current()) setLoading(false)
    }
  }, [isCompany, roomId])

  useEffect(() => {
    if (!roomId) return undefined
    const scope = {}
    lifetime.current = scope
    setSession(null)
    setHasLoaded(false)
    setFormOpen(false)
    setError('')
    setNotice('')
    void loadSessions().catch(() => {})
    return () => {
      if (lifetime.current === scope) lifetime.current = null
      readGeneration.current += 1
      pendingWrite.current = null
    }
  }, [loadSessions, roomId])

  const beginWrite = () => {
    if (!lifetime.current || actionsLockedRef.current || readUncertainRef.current || pendingWrite.current) return null
    const ticket = { scope: lifetime.current }
    pendingWrite.current = ticket
    readGeneration.current += 1
    setLoading(false)
    setError('')
    setNotice('')
    return ticket
  }
  const currentWrite = ticket => lifetime.current === ticket.scope && pendingWrite.current === ticket
  const writeError = err => {
    if (DEFINITE_WRITE_REJECTIONS.has(err?.status)) {
      setError(err.message)
      return
    }
    readGeneration.current += 1
    setLoading(false)
    readUncertainRef.current = true
    setReadUncertain(true)
    unknownWrite.current = true
    setReadError('처리 결과를 확인하지 못했습니다. 같은 작업을 다시 보내지 말고 일정을 다시 불러와 확인해주세요.')
  }
  const controlsLocked = disabled || writeLocked || readUncertain

  const createSession = async (event) => {
    event.preventDefault()
    if (actionsLockedRef.current || readUncertainRef.current || pendingWrite.current) return
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('면접 제목을 입력해주세요.')
      return
    }

    const ticket = beginWrite()
    if (!ticket) return
    const submittedVersion = draftVersion.current
    setCreating(true)
    try {
      if (!createRequestIdRef.current) {
        createRequestIdRef.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
      }
      const created = await api.post(`/rooms/${roomId}/interviews`, {
        title: cleanTitle,
        scheduledAt: toScheduledIso(scheduledAt),
        durationMinutes,
        recordingRequired,
        clientRequestId: createRequestIdRef.current,
      })
      if (!currentWrite(ticket)) return
      const next = normalizeSession(created)
      if (!usableSession(next)) throw new Error('생성된 화상 면접 정보를 확인하지 못했습니다.')
      // The write is already confirmed. A later detail GET must never turn this
      // into a failed creation or erase a different draft entered meanwhile.
      setSession(next)
      setHasLoaded(true)
      if (draftVersion.current === submittedVersion) setFormOpen(false)
      createRequestIdRef.current = ''
      setNotice('일정은 생성되었습니다.')
      await loadSessions({ knownSession: next }).catch(() => {})
    } catch (err) {
      if (currentWrite(ticket)) {
        if (DEFINITE_WRITE_REJECTIONS.has(err?.status)) createRequestIdRef.current = ''
        else unknownCreateVersion.current = submittedVersion
        writeError(err)
      }
    } finally {
      if (currentWrite(ticket)) { pendingWrite.current = null; setCreating(false) }
    }
  }

  const canEnter = session && !controlsLocked && !isClosedInterviewStatus(session.status)
  const isSessionHost = isCompany && session?.myRole === 'host'
  const canCancel = Boolean(
    (isSessionHost || (session?.myRole === 'candidate' && session?.bookingSlotId)) && !disabled && ['scheduled', 'waiting'].includes(session?.status)
  )
  const memberChangesUnavailable = Boolean(
    disabled ||
      !session ||
      session.status === 'live' ||
      isClosedInterviewStatus(session.status) ||
      session.members?.some((member) => member.admittedAt || member.joinedAt)
  )

  const updateMembers = (response) => {
    if (!Array.isArray(response?.members)) throw new Error('면접관 목록 응답을 확인하지 못했습니다.')
    const members = response.members
    setSession((previous) =>
      previous ? normalizeSession({ ...previous, members }) ?? previous : previous
    )
  }

  const updateRecording = (recording) => {
    if (!recording) return
    setSession((previous) => {
      if (!previous) return previous
      const recordings = (previous.recordings ?? []).map((item) =>
        item.id === recording.id ? recording : item
      )
      if (!recordings.some((item) => item.id === recording.id)) recordings.unshift(recording)
      return normalizeSession({
        ...previous,
        recordings,
        currentRecording: recording,
      })
    })
  }

  const addInterviewer = async (event) => {
    event.preventDefault()
    const email = memberEmail.trim()
    if (memberChangesUnavailable || !email || !session?.id) return
    const ticket = beginWrite()
    if (!ticket) return
    const submittedEmail = memberEmail
    setMemberBusy('add')
    setMemberError('')
    try {
      const response = await api.post(
        `/rooms/${roomId}/interviews/${session.id}/members`,
        { email }
      )
      if (!currentWrite(ticket)) return
      updateMembers(response)
      setMemberEmail(current => current === submittedEmail ? '' : current)
    } catch (err) {
      if (currentWrite(ticket)) {
        if (DEFINITE_WRITE_REJECTIONS.has(err?.status)) setMemberError(err.message)
        else writeError(err)
      }
    } finally {
      if (currentWrite(ticket)) { pendingWrite.current = null; setMemberBusy('') }
    }
  }

  const removeInterviewer = async (userId) => {
    if (memberChangesUnavailable || !session?.id) return
    const ticket = beginWrite()
    if (!ticket) return
    setMemberBusy(userId)
    setMemberError('')
    try {
      const response = await api.delete(
        `/rooms/${roomId}/interviews/${session.id}/members`,
        { userId }
      )
      if (!currentWrite(ticket)) return
      updateMembers(response)
    } catch (err) {
      if (currentWrite(ticket)) {
        if (DEFINITE_WRITE_REJECTIONS.has(err?.status)) setMemberError(err.message)
        else writeError(err)
      }
    } finally {
      if (currentWrite(ticket)) { pendingWrite.current = null; setMemberBusy('') }
    }
  }

  const copyInterviewerLink = async () => {
    if (actionsLockedRef.current || readUncertainRef.current || !session?.id) return
    setCopyState('')
    try {
      const path = interviewerPagePath(roomId, session.id)
      await navigator.clipboard.writeText(`${window.location.origin}${path}`)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const cancelSession = async () => {
    if (actionsLockedRef.current || readUncertainRef.current || pendingWrite.current || !canCancel || !session?.id) return
    if (!window.confirm('이 화상 면접 일정을 취소하시겠습니까? 기존 참석 링크도 사용할 수 없게 됩니다.')) {
      return
    }

    const ticket = beginWrite()
    if (!ticket) return
    setCancelling(true)
    try {
      const response = await api.patch(`/rooms/${roomId}/interviews/${session.id}`, {
        status: 'cancelled',
      })
      if (!currentWrite(ticket)) return
      const next = normalizeSession(response)
      if (!usableSession(next) || next.id !== session.id) throw new Error('취소된 화상 면접 정보를 확인하지 못했습니다.')
      setSession(next)
    } catch (err) {
      if (currentWrite(ticket)) writeError(err)
    } finally {
      if (currentWrite(ticket)) { pendingWrite.current = null; setCancelling(false) }
    }
  }

  return (
    <section className="interview-session-panel" aria-labelledby="video-interview-heading">
      <div className="interview-session-panel__heading">
        <div>
          <span className="interview-session-panel__eyebrow">화상 면접</span>
          <h2 id="video-interview-heading">면접 일정</h2>
        </div>
        {isCompany && session && !formOpen && !disabled && (
          <button
            type="button"
            className="interview-text-button"
            disabled={controlsLocked || creating}
            onClick={() => { if (!actionsLockedRef.current && !readUncertainRef.current && !pendingWrite.current) setFormOpen(true) }}
          >
            새 일정 만들기
          </button>
        )}
      </div>

      {loading && <p className="interview-panel-status" role="status">일정을 불러오는 중입니다.</p>}
      {error && <p className="interview-inline-error" role="alert">{error}</p>}
      {notice && <p className="interview-panel-status" role="status">{notice}</p>}
      {readError && <div role="alert"><p className="interview-inline-error">{readError}</p><button type="button" className="interview-text-button" disabled={loading} onClick={() => { void loadSessions().catch(() => {}) }}>일정 다시 불러오기</button></div>}
      {(writeLocked || (hasLoaded && readUncertain)) && !disabled && <p className="interview-panel-status" role="status">면접방 상태 확인 중에는 일정 변경과 입장이 잠시 잠깁니다. 작성 중인 내용은 유지됩니다.</p>}

      {hasLoaded && (isCompany || myRole === 'candidate') && <InterviewSlotPicker roomId={roomId} isCompany={isCompany} session={session} disabled={disabled} writeLocked={controlsLocked || creating || Boolean(memberBusy) || cancelling} onChanged={loadSessions} />}

      {hasLoaded && session && !formOpen && (
        <article className="interview-session-card">
          <div className="interview-session-card__main">
            <div className="interview-session-card__copy">
              <div className="interview-session-card__meta">
                <span>{formatScheduledAt(session.scheduledAt)}</span>
                <span>{session.durationMinutes ?? 30}분</span>
                <span aria-hidden="true">·</span>
                <span>{session.statusLabel}</span>
                {session.recordingRequired && (
                  <span className="interview-recording-chip">
                    <span className="interview-recording-chip__dot" aria-hidden="true" />
                    녹화 동의 필수
                  </span>
                )}
              </div>
              <h3>{session.title}</h3>
              {session.recordingRequired && (
                <p>녹화에 동의한 참가자만 이 화상 면접에 입장할 수 있습니다.</p>
              )}
            </div>
            <div className="interview-session-card__actions">
              {canEnter ? (
                <a
                  className="interview-enter-link"
                  href={interviewPagePath(roomId, session.id)}
                  onClick={event => { if (actionsLockedRef.current || readUncertainRef.current) event.preventDefault() }}
                >
                  화상 면접 열기
                  <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <span className="interview-session-card__closed">
                  {disabled ? '면접방이 잠겨 있어 입장할 수 없습니다.' : controlsLocked ? '면접방 상태 확인 후 입장할 수 있습니다.' : '입장할 수 없는 일정입니다.'}
                </span>
              )}
              {canCancel && (
                <button
                  type="button"
                  className="interview-cancel-button"
                  disabled={controlsLocked || cancelling || creating || Boolean(memberBusy)}
                  onClick={cancelSession}
                >
                  {cancelling ? '취소 중…' : '일정 취소'}
                </button>
              )}
            </div>
          </div>

          <RecordingResult
            roomId={roomId}
            session={session}
            onRecordingChanged={updateRecording}
            writeLocked={controlsLocked}
          />

          {isSessionHost && (
            <section className="interview-member-manager" aria-labelledby="interview-members-heading">
              <div className="interview-member-manager__heading">
                <div>
                  <span>참가 계정</span>
                  <h4 id="interview-members-heading">면접관</h4>
                </div>
                {canEnter && (
                  <button type="button" onClick={copyInterviewerLink}>
                    {copyState === 'copied' ? '링크 복사됨' : '참석 링크 복사'}
                  </button>
                )}
              </div>

              {copyState === 'failed' && (
                <p className="interview-member-error" role="alert">
                  참석 링크를 복사하지 못했습니다.
                </p>
              )}

              <ul className="interview-member-list">
                {(session.members ?? [])
                  .filter((member) => ['host', 'interviewer'].includes(member.role))
                  .map((member) => (
                    <li key={member.userId ?? member.customParticipantId}>
                      <span>
                        <strong>{member.displayName}</strong>
                        <small>{member.role === 'host' ? '진행자' : '면접관'}</small>
                      </span>
                      {member.role === 'interviewer' && !memberChangesUnavailable && (
                        <button
                          type="button"
                          disabled={controlsLocked || Boolean(memberBusy) || cancelling || creating}
                          onClick={() => removeInterviewer(member.userId)}
                        >
                          {memberBusy === member.userId ? '제외 중…' : '제외'}
                        </button>
                      )}
                    </li>
                  ))}
              </ul>

              {!memberChangesUnavailable ? (
                <form className="interview-member-form" onSubmit={addInterviewer}>
                  <label htmlFor="interview-member-email">회사 계정 이메일</label>
                  <div>
                    <input
                      id="interview-member-email"
                      type="email"
                      disabled={controlsLocked}
                      value={memberEmail}
                      onChange={(event) => setMemberEmail(event.target.value)}
                      maxLength={254}
                      autoComplete="email"
                      placeholder="name@company.com"
                      required
                    />
                    <button type="submit" disabled={controlsLocked || Boolean(memberBusy) || cancelling || creating}>
                      {memberBusy === 'add' ? '추가 중…' : '면접관 추가'}
                    </button>
                  </div>
                </form>
              ) : (
                <p className="interview-member-manager__locked">
                  참가자 입장이 시작되었거나 일정이 종료되어 면접관을 바꿀 수 없습니다.
                </p>
              )}
              {memberError && (
                <p className="interview-member-error" role="alert">{memberError}</p>
              )}
            </section>
          )}
        </article>
      )}

      {hasLoaded && !session && !formOpen && (
        <p className="interview-panel-status">예정된 화상 면접이 없습니다.</p>
      )}

      {isCompany && formOpen && !disabled && (
        <form className="interview-session-form" onSubmit={createSession}>
          <label>
            <span>면접 제목</span>
            <input
              value={title}
              disabled={controlsLocked}
              onChange={(event) => { draftVersion.current += 1; setTitle(event.target.value) }}
              maxLength={120}
              autoComplete="off"
              required
            />
          </label>
          <label>
            <span>예정 시간</span>
            <input
              type="datetime-local"
              disabled={controlsLocked}
              value={scheduledAt}
              onChange={(event) => { draftVersion.current += 1; setScheduledAt(event.target.value) }}
            />
          </label>
          <label><span>소요 시간</span><select disabled={controlsLocked} value={durationMinutes} onChange={event => { draftVersion.current += 1; setDurationMinutes(Number(event.target.value)) }}>{[15,30,45,60,90,120].map(minutes => <option key={minutes} value={minutes}>{minutes}분</option>)}</select></label>
          <label className="interview-recording-option">
            <input
              type="checkbox"
              disabled={controlsLocked}
              checked={recordingRequired}
              onChange={(event) => { draftVersion.current += 1; setRecordingRequired(event.target.checked) }}
            />
            <span>
              <strong>녹화 면접</strong>
              <small>녹화에 동의하지 않으면 해당 화상 면접에 입장할 수 없습니다.</small>
            </span>
          </label>
          <div className="interview-session-form__actions">
            {session && (
              <button type="button" onClick={() => { if (!actionsLockedRef.current && !readUncertainRef.current && !pendingWrite.current) setFormOpen(false) }} disabled={controlsLocked || creating}>
                취소
              </button>
            )}
            <button type="submit" className="interview-primary-button" disabled={controlsLocked || creating || Boolean(memberBusy) || cancelling}>
              {creating ? '만드는 중…' : '일정 만들기'}
            </button>
          </div>
        </form>
      )}

      {isCompany && disabled && (
        <p className="interview-panel-status">보관되거나 종료된 면접방에서는 새 일정을 만들 수 없습니다.</p>
      )}
    </section>
  )
}
