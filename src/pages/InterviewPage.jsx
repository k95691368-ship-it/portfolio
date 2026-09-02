import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, markRoomDoor } from '../api/client.js'
import InterviewConversationPanel from '../features/interview/InterviewConversationPanel.jsx'
import InterviewerHuddleControl from '../features/interview/InterviewerHuddleControl.jsx'
import RealtimeInterview from '../features/interview/RealtimeInterview.jsx'
import RecordingBar from '../features/interview/RecordingBar.jsx'
import { huddleLocksRecordingControls } from '../features/interview/collaborationModel.js'
import {
  extractJoinCredentials,
  hasCompleteConsentNotice,
  interviewPagePath,
  isClosedInterviewStatus,
  normalizeSession,
} from '../features/interview/sessionModel.js'
import '../features/interview/interview.css'

function StateScreen({ symbol, title, children, roomHref, action }) {
  return (
    <div className="interview-state-screen">
      <div className="interview-state-card">
        <span className="interview-state-symbol" aria-hidden="true">{symbol}</span>
        <h1>{title}</h1>
        <div className="interview-state-card__copy">{children}</div>
        <div className="interview-state-card__actions">
          {action}
          <a href={roomHref} className="interview-secondary-link">면접방으로 돌아가기</a>
        </div>
      </div>
    </div>
  )
}

function ConsentGate({ session, busy, error, onDecision, roomHref }) {
  const notice = session.consentNotice
  return (
    <div className="interview-consent-layout">
      <section className="interview-consent-card" aria-labelledby="recording-consent-title">
        <div className="interview-consent-card__mark" aria-hidden="true">
          <span />
        </div>
        <p className="interview-consent-eyebrow">녹화 안내</p>
        <h1 id="recording-consent-title">녹화 동의가 필요한 면접입니다.</h1>
        <p className="interview-consent-lead">
          내용을 확인한 뒤 동의 여부를 선택해주세요. 동의하지 않으면 이 화상
          면접에 입장할 수 없습니다.
        </p>

        <dl className="interview-consent-details">
          <div>
            <dt>녹화 목적</dt>
            <dd>{notice.purpose}</dd>
          </div>
          <div>
            <dt>녹화되는 항목</dt>
            <dd>
              <ul>
                {notice.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </dd>
          </div>
          <div>
            <dt>보관 기간</dt>
            <dd>{notice.retention}</dd>
          </div>
          <div>
            <dt>동의하지 않는 경우</dt>
            <dd>{notice.refusalEffect}</dd>
          </div>
        </dl>

        {error && <p className="interview-inline-error" role="alert">{error}</p>}
        <div className="interview-consent-actions">
          <button
            type="button"
            className="interview-primary-button"
            disabled={busy}
            onClick={() => onDecision(true)}
          >
            {busy ? '처리 중…' : '동의하고 장치 설정으로'}
          </button>
          <button type="button" disabled={busy} onClick={() => onDecision(false)}>
            동의하지 않음
          </button>
        </div>
        <a href={roomHref} className="interview-consent-back">면접방으로 돌아가기</a>
      </section>
    </div>
  )
}

export default function InterviewPage() {
  const { roomId, sessionId } = useParams()
  const roomHref = `/rooms/${encodeURIComponent(roomId ?? '')}`
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadErrorStatus, setLoadErrorStatus] = useState(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [credentials, setCredentials] = useState(null)
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')
  const [consentBusy, setConsentBusy] = useState(false)
  const [consentError, setConsentError] = useState('')
  const [connectionState, setConnectionState] = useState('connecting')
  const [online, setOnline] = useState(() => navigator.onLine)
  const [meetingClient, setMeetingClient] = useState(null)
  const [meetingJoined, setMeetingJoined] = useState(false)
  const [conversationOpen, setConversationOpen] = useState(false)
  const [huddlePhase, setHuddlePhase] = useState('parent')
  const loadedKeyRef = useRef('')
  const joinRequestRef = useRef('')

  useLayoutEffect(() => {
    if (!roomId) return
    const identity = new URLSearchParams(window.location.search).get('identity')
    if (identity === 'account') markRoomDoor(roomId, 'account')
  }, [roomId])

  useEffect(() => {
    const previousTitle = document.title
    document.body.classList.add('interview-live-body')
    document.title = '화상 면접'
    return () => {
      document.body.classList.remove('interview-live-body')
      document.title = previousTitle
    }
  }, [])

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    if (!roomId || !sessionId) return
    const key = `${roomId}:${sessionId}:${loadAttempt}`
    if (loadedKeyRef.current === key) return
    loadedKeyRef.current = key
    let current = true
    setLoading(true)
    setLoadError('')
    setLoadErrorStatus(null)
    void api
      .get(`/rooms/${roomId}/interviews/${sessionId}`)
      .then((data) => {
        if (!current) return
        const next = normalizeSession(data)
        if (!next?.id) throw new Error('화상 면접 일정을 확인하지 못했습니다.')
        setSession(next)
      })
      .catch((err) => {
        if (!current) return
        setLoadError(err.message)
        setLoadErrorStatus(err.status ?? null)
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [loadAttempt, roomId, sessionId])

  const requestJoinToken = useCallback(async () => {
    if (!roomId || !session?.id || credentials) return
    const consentKey = session.recordingRequired ? String(session.myConsent?.granted) : 'not-required'
    const requestKey = `${session.id}:${consentKey}`
    if (joinRequestRef.current === requestKey) return
    joinRequestRef.current = requestKey
    setJoining(true)
    setJoinError('')
    try {
      const data = await api.post(
        `/rooms/${roomId}/interviews/${session.id}/join-token`,
        {}
      )
      const next = extractJoinCredentials(data)
      if (!next) throw new Error('화상 면접 연결 설정이 아직 완료되지 않았습니다.')
      setCredentials(next)
    } catch (err) {
      joinRequestRef.current = ''
      setJoinError(err.message)
    } finally {
      setJoining(false)
    }
  }, [credentials, roomId, session])

  useEffect(() => {
    if (!session || session.providerConfigured === false || isClosedInterviewStatus(session.status)) return
    if (session.recordingRequired && session.myConsent?.granted !== true) return
    void requestJoinToken()
  }, [requestJoinToken, session])

  useEffect(() => {
    if (
      !credentials ||
      !roomId ||
      !session?.id ||
      isClosedInterviewStatus(session.status)
    ) return
    let current = true
    const refresh = async () => {
      try {
        const data = await api.get(`/rooms/${roomId}/interviews/${session.id}`)
        if (!current) return
        const next = normalizeSession(data)
        if (!next) return
        setSession((previous) => ({
          ...previous,
          ...next,
          consentNotice: next.consentNotice ?? previous.consentNotice,
          myConsent: next.myConsent ?? previous.myConsent,
        }))
      } catch {
        // 상태 조회가 잠시 실패해도 통화는 계속한다. 녹화 제어 요청은 각각의
        // 오류를 표시하고, 종료·취소 상태는 다음 조회에서 다시 맞춘다.
      }
    }
    const timer = window.setInterval(refresh, 5000)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [credentials, roomId, session?.id, session?.status])

  const submitConsent = async (granted) => {
    const notice = session?.consentNotice
    if (!session || !hasCompleteConsentNotice(notice)) return
    setConsentBusy(true)
    setConsentError('')
    try {
      const response = await api.post(`/rooms/${roomId}/interviews/${session.id}/consent`, {
        granted,
        noticeVersion: notice.version,
        noticeHash: notice.hash,
      })
      const returnedSession = normalizeSession(response)
      const nextSession = {
        ...(returnedSession ?? session),
        myConsent: { granted, version: notice.version, hash: notice.hash },
      }
      setSession(nextSession)
      if (granted) {
        joinRequestRef.current = ''
      } else {
        joinRequestRef.current = ''
        setCredentials(null)
        setMeetingJoined(false)
        void meetingClient?.leave?.().catch(() => {})
      }
    } catch (err) {
      // 철회 정본은 공급자 퇴장보다 먼저 D1에 저장된다. 공급자 정리가 실패해
      // 502가 와도 화면이 옛 동의·토큰을 계속 붙들고 있으면 안 된다.
      if (err.data?.granted === false) {
        const returnedSession = normalizeSession(err.data)
        setSession({
          ...(returnedSession ?? session),
          myConsent: {
            granted: false,
            version: notice.version,
            hash: notice.hash,
          },
        })
        joinRequestRef.current = ''
        setCredentials(null)
        setMeetingJoined(false)
        void meetingClient?.leave?.().catch(() => {})
      }
      const latestNotice = err.data?.consentNotice
      if (latestNotice && err.data?.granted !== false) {
        const updated = normalizeSession({
          ...session,
          consentNotice: latestNotice,
        })
        if (updated) setSession(updated)
      }
      setConsentError(err.message)
    } finally {
      setConsentBusy(false)
    }
  }

  const updateRecording = (recording) => {
    setSession((previous) => (previous ? { ...previous, recording } : previous))
  }

  const retryLoad = (
    <button
      type="button"
      className="interview-primary-button"
      onClick={() => {
        loadedKeyRef.current = ''
        setLoadAttempt((value) => value + 1)
      }}
    >
      다시 불러오기
    </button>
  )

  if (loading) {
    return (
      <div className="interview-page" data-clarity-mask="true">
        <div className="interview-meeting-loading" role="status">
          <span className="interview-spinner" aria-hidden="true" />
          <p>화상 면접을 불러오는 중입니다.</p>
        </div>
      </div>
    )
  }

  if (loadError || !session) {
    const loginHref = `/login?next=${encodeURIComponent(
      interviewPagePath(roomId ?? '', sessionId ?? '')
    )}`
    return (
      <div className="interview-page" data-clarity-mask="true">
        <StateScreen
          symbol="!"
          title="면접 일정을 열지 못했습니다."
          roomHref={roomHref}
          action={loadErrorStatus === 401 ? (
            <a className="interview-primary-link" href={loginHref}>회사 계정으로 로그인</a>
          ) : retryLoad}
        >
          <p role="alert">{loadError || '잠시 후 다시 시도해주세요.'}</p>
        </StateScreen>
      </div>
    )
  }

  if (isClosedInterviewStatus(session.status)) {
    return (
      <div className="interview-page" data-clarity-mask="true">
        <StateScreen symbol="✓" title="종료된 화상 면접입니다." roomHref={roomHref}>
          <p>{session.title}</p>
        </StateScreen>
      </div>
    )
  }

  if (session.providerConfigured === false) {
    return (
      <div className="interview-page" data-clarity-mask="true">
        <StateScreen symbol="…" title="화상 연결을 준비하고 있습니다." roomHref={roomHref}>
          <p>회의 연결 설정이 완료된 뒤 입장할 수 있습니다.</p>
        </StateScreen>
      </div>
    )
  }

  if (session.recordingRequired && !hasCompleteConsentNotice(session.consentNotice)) {
    return (
      <div className="interview-page" data-clarity-mask="true">
        <StateScreen symbol="!" title="녹화 안내를 확인할 수 없습니다." roomHref={roomHref}>
          <p>녹화 목적과 보관 기간을 확인할 수 있을 때까지 입장을 진행하지 않습니다.</p>
        </StateScreen>
      </div>
    )
  }

  if (session.recordingRequired && session.myConsent?.granted === false) {
    return (
      <div className="interview-page" data-clarity-mask="true">
        <StateScreen
          symbol="—"
          title="이 화상 면접에 입장할 수 없습니다."
          roomHref={roomHref}
          action={(
            <button
              type="button"
              className="interview-primary-button"
              onClick={() => {
                joinRequestRef.current = ''
                setSession((previous) =>
                  previous ? { ...previous, myConsent: null } : previous
                )
              }}
            >
              녹화 안내 다시 보기
            </button>
          )}
        >
          <p>이 면접은 녹화 동의가 필수입니다. 녹화에 동의하지 않아 입장을 진행하지 않습니다.</p>
        </StateScreen>
      </div>
    )
  }

  if (session.recordingRequired && session.myConsent?.granted !== true) {
    return (
      <div className="interview-page" data-clarity-mask="true">
        <ConsentGate
          session={session}
          busy={consentBusy}
          error={consentError}
          onDecision={submitConsent}
          roomHref={roomHref}
        />
      </div>
    )
  }

  if (joinError) {
    return (
      <div className="interview-page" data-clarity-mask="true">
        <StateScreen
          symbol="!"
          title="화상 면접에 연결하지 못했습니다."
          roomHref={roomHref}
          action={(
            <button
              type="button"
              className="interview-primary-button"
              onClick={() => {
                joinRequestRef.current = ''
                void requestJoinToken()
              }}
            >
              다시 시도
            </button>
          )}
        >
          <p role="alert">{joinError}</p>
        </StateScreen>
      </div>
    )
  }

  if (joining || !credentials) {
    return (
      <div className="interview-page" data-clarity-mask="true">
        <div className="interview-meeting-loading" role="status">
          <span className="interview-spinner" aria-hidden="true" />
          <p>입장을 준비하는 중입니다.</p>
        </div>
      </div>
    )
  }

  const connectionLabel = !online
    ? '인터넷 연결 없음'
    : connectionState === 'reconnecting'
      ? '다시 연결하는 중'
      : connectionState === 'failed'
        ? '연결 확인 필요'
        : meetingJoined && connectionState === 'connected'
          ? '연결됨'
          : connectionState === 'left'
            ? '면접에서 나감'
            : '입장 전'

  return (
    <div className="interview-page interview-page--meeting" data-clarity-mask="true">
      <header className="interview-live-header">
        <a href={roomHref} className="interview-live-header__back" aria-label="면접방으로 돌아가기">
          <span aria-hidden="true">‹</span>
        </a>
        <div className="interview-live-header__title">
          <strong>{session.title}</strong>
          <span>{session.statusLabel}</span>
        </div>
        <div className="interview-live-header__actions">
          <InterviewerHuddleControl
            roomId={roomId}
            session={session}
            meeting={meetingClient}
            meetingJoined={meetingJoined}
            onRecordingChanged={updateRecording}
            onWorkflowStateChange={setHuddlePhase}
          />
          <button
            type="button"
            className={`interview-conversation-toggle${conversationOpen ? ' is-active' : ''}`}
            aria-expanded={conversationOpen}
            onClick={() => setConversationOpen((value) => !value)}
          >
            대화
          </button>
          <div className={`interview-network-state${online ? '' : ' is-offline'}`} role="status">
            <span aria-hidden="true" />
            {connectionLabel}
          </div>
        </div>
      </header>

      <RecordingBar
        roomId={roomId}
        session={session}
        meetingJoined={meetingJoined}
        controlsLocked={huddleLocksRecordingControls(huddlePhase)}
        onRecordingChanged={updateRecording}
      />

      {!online && (
        <p className="interview-offline-banner" role="alert">
          인터넷 연결이 끊겼습니다. 연결이 돌아오면 자동으로 다시 연결합니다.
        </p>
      )}

      <div className="interview-workspace">
        <RealtimeInterview
          credentials={credentials}
          onConnectionState={setConnectionState}
          onMeetingChange={setMeetingClient}
          onJoinedChange={setMeetingJoined}
        />
        <InterviewConversationPanel
          open={conversationOpen}
          onClose={() => setConversationOpen(false)}
          roomId={roomId}
          session={session}
          meeting={meetingClient}
        />
      </div>
    </div>
  )
}
