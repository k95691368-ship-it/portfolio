import { useEffect, useRef, useState } from 'react'
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

function RecordingResult({ roomId, session, onRecordingChanged }) {
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState('')
  const recording = session?.recording
  if (!recording?.id || recording.status === 'idle') return null

  const expired = recording.expired || recording.status === 'deleted'
  const storageFailed = recording.storageStatus === 'copy_failed'
  const canPlay = Boolean(
    recording.status === 'available' &&
      recording.available !== false &&
      !expired &&
      !storageFailed &&
      (!recording.storageStatus || recording.storageStatus === 'stored')
  )
  const retentionDate = formatRetentionDate(recording.retentionUntil)

  let detail = recording.label
  if (expired) detail = '보관 기간이 끝나 녹화 파일이 삭제되었습니다.'
  else if (recording.status === 'processing' || recording.storageStatus === 'copying') {
    detail = '녹화 파일을 처리하는 중입니다.'
  } else if (recording.status === 'failed' || storageFailed) {
    detail = '녹화 파일을 준비하지 못했습니다.'
  } else if (recording.status === 'available' && !canPlay) {
    detail = '녹화 파일을 보관하는 중입니다.'
  }

  const selectedDoor = roomDoorFor(roomId)
  const identity = selectedDoor === 'code' || selectedDoor === 'account' ? selectedDoor : ''
  const filePath = recordingFilePath(roomId, session.id, recording.id, false, identity)

  const retryStorage = async () => {
    if (!recording?.id || retrying) return
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
          <video controls preload="metadata" src={filePath}>
            이 브라우저에서는 녹화 영상을 재생할 수 없습니다.
          </video>
          <a
            className="interview-recording-download"
            href={recordingFilePath(roomId, session.id, recording.id, true, identity)}
          >
            녹화 파일 다운로드
          </a>
        </>
      )}
      {storageFailed && session.myRole === 'host' && (
        <div className="interview-recording-retry">
          <button type="button" disabled={retrying} onClick={retryStorage}>
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
}) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState(roomTitle ? `${roomTitle} 화상 면접` : '화상 면접')
  const [scheduledAt, setScheduledAt] = useState('')
  const [recordingRequired, setRecordingRequired] = useState(true)
  const [memberEmail, setMemberEmail] = useState('')
  const [memberBusy, setMemberBusy] = useState('')
  const [memberError, setMemberError] = useState('')
  const [copyState, setCopyState] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const loadedRoomRef = useRef('')
  const createRequestIdRef = useRef('')

  const isCompany = myRole === 'company'

  const loadSessionDetail = async (summary) => {
    if (!summary?.id) return summary
    const detail = await api.get(`/rooms/${roomId}/interviews/${summary.id}`)
    return normalizeSession(detail) ?? summary
  }

  const loadSessions = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.get(`/rooms/${roomId}/interviews`)
      const summary = latestSession(data)
      const next = await loadSessionDetail(summary)
      setSession(next)
      if (!next && isCompany) setFormOpen(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!roomId || loadedRoomRef.current === roomId) return
    loadedRoomRef.current = roomId
    void loadSessions()
  }, [roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  const createSession = async (event) => {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('면접 제목을 입력해주세요.')
      return
    }

    setCreating(true)
    setError('')
    try {
      if (!createRequestIdRef.current) {
        createRequestIdRef.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
      }
      const created = await api.post(`/rooms/${roomId}/interviews`, {
        title: cleanTitle,
        scheduledAt: toScheduledIso(scheduledAt),
        recordingRequired,
        clientRequestId: createRequestIdRef.current,
      })
      const next = normalizeSession(created)
      if (!next?.id) throw new Error('생성된 화상 면접 정보를 확인하지 못했습니다.')
      setSession(await loadSessionDetail(next))
      setFormOpen(false)
      createRequestIdRef.current = ''
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const canEnter = session && !disabled && !isClosedInterviewStatus(session.status)
  const isSessionHost = isCompany && session?.myRole === 'host'
  const canCancel = Boolean(
    isSessionHost && !disabled && ['scheduled', 'waiting'].includes(session?.status)
  )
  const memberChangesLocked = Boolean(
    disabled ||
      !session ||
      session.status === 'live' ||
      isClosedInterviewStatus(session.status) ||
      session.members?.some((member) => member.admittedAt || member.joinedAt)
  )

  const updateMembers = (response) => {
    const members = Array.isArray(response?.members) ? response.members : []
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
    if (!email || !session?.id || memberBusy) return
    setMemberBusy('add')
    setMemberError('')
    try {
      const response = await api.post(
        `/rooms/${roomId}/interviews/${session.id}/members`,
        { email }
      )
      updateMembers(response)
      setMemberEmail('')
    } catch (err) {
      setMemberError(err.message)
    } finally {
      setMemberBusy('')
    }
  }

  const removeInterviewer = async (userId) => {
    if (!session?.id || memberBusy) return
    setMemberBusy(userId)
    setMemberError('')
    try {
      const response = await api.delete(
        `/rooms/${roomId}/interviews/${session.id}/members`,
        { userId }
      )
      updateMembers(response)
    } catch (err) {
      setMemberError(err.message)
    } finally {
      setMemberBusy('')
    }
  }

  const copyInterviewerLink = async () => {
    if (!session?.id) return
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
    if (!canCancel || cancelling || !session?.id) return
    if (!window.confirm('이 화상 면접 일정을 취소하시겠습니까? 기존 참석 링크도 사용할 수 없게 됩니다.')) {
      return
    }

    setCancelling(true)
    setError('')
    try {
      const response = await api.patch(`/rooms/${roomId}/interviews/${session.id}`, {
        status: 'cancelled',
      })
      const next = normalizeSession(response)
      if (!next) throw new Error('취소된 화상 면접 정보를 확인하지 못했습니다.')
      setSession(next)
    } catch (err) {
      setError(err.message)
    } finally {
      setCancelling(false)
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
            onClick={() => setFormOpen(true)}
          >
            새 일정 만들기
          </button>
        )}
      </div>

      {loading && <p className="interview-panel-status" role="status">일정을 불러오는 중입니다.</p>}
      {error && <p className="interview-inline-error" role="alert">{error}</p>}

      {!loading && session && !formOpen && (
        <article className="interview-session-card">
          <div className="interview-session-card__main">
            <div className="interview-session-card__copy">
              <div className="interview-session-card__meta">
                <span>{formatScheduledAt(session.scheduledAt)}</span>
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
                >
                  화상 면접 열기
                  <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <span className="interview-session-card__closed">
                  {disabled ? '면접방이 잠겨 있어 입장할 수 없습니다.' : '입장할 수 없는 일정입니다.'}
                </span>
              )}
              {canCancel && (
                <button
                  type="button"
                  className="interview-cancel-button"
                  disabled={cancelling}
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
                      {member.role === 'interviewer' && !memberChangesLocked && (
                        <button
                          type="button"
                          disabled={Boolean(memberBusy)}
                          onClick={() => removeInterviewer(member.userId)}
                        >
                          {memberBusy === member.userId ? '제외 중…' : '제외'}
                        </button>
                      )}
                    </li>
                  ))}
              </ul>

              {!memberChangesLocked ? (
                <form className="interview-member-form" onSubmit={addInterviewer}>
                  <label htmlFor="interview-member-email">회사 계정 이메일</label>
                  <div>
                    <input
                      id="interview-member-email"
                      type="email"
                      value={memberEmail}
                      onChange={(event) => setMemberEmail(event.target.value)}
                      maxLength={254}
                      autoComplete="email"
                      placeholder="name@company.com"
                      required
                    />
                    <button type="submit" disabled={Boolean(memberBusy)}>
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

      {!loading && !session && !formOpen && (
        <p className="interview-panel-status">예정된 화상 면접이 없습니다.</p>
      )}

      {isCompany && formOpen && !disabled && (
        <form className="interview-session-form" onSubmit={createSession}>
          <label>
            <span>면접 제목</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              autoComplete="off"
              required
            />
          </label>
          <label>
            <span>예정 시간</span>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </label>
          <label className="interview-recording-option">
            <input
              type="checkbox"
              checked={recordingRequired}
              onChange={(event) => setRecordingRequired(event.target.checked)}
            />
            <span>
              <strong>녹화 면접</strong>
              <small>녹화에 동의하지 않으면 해당 화상 면접에 입장할 수 없습니다.</small>
            </span>
          </label>
          <div className="interview-session-form__actions">
            {session && (
              <button type="button" onClick={() => setFormOpen(false)} disabled={creating}>
                취소
              </button>
            )}
            <button type="submit" className="interview-primary-button" disabled={creating}>
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
