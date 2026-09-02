import { useCallback, useEffect, useRef, useState } from 'react'
import { useRealtimeKitClient } from '@cloudflare/realtimekit-react'
import { RtkMeeting, useLanguage } from '@cloudflare/realtimekit-react-ui'
import {
  INTERVIEW_KO_DICTIONARY,
  INTERVIEW_MEETING_UI_PROPS,
} from './interviewMeetingConfig.js'

function safeMeetingError(error) {
  const code = String(error?.code ?? '')
  const message = String(error?.message ?? '').toLowerCase()
  if (code === '0010' || message.includes('not supported')) {
    return '이 브라우저에서는 화상 면접을 사용할 수 없습니다. 최신 Chrome, Edge 또는 Safari에서 다시 열어주세요.'
  }
  if (message.includes('permission') || message.includes('denied')) {
    return '카메라와 마이크 권한을 확인한 뒤 다시 시도해주세요.'
  }
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('connect') ||
    code === '0001'
  ) {
    return '연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.'
  }
  return '화상 면접 연결을 준비하지 못했습니다.'
}

function connectionStateFromEvent(event) {
  const value = String(event?.state ?? event?.status ?? event ?? '').toLowerCase()
  if (value.includes('disconnect') || value.includes('reconnect') || value.includes('fail')) {
    return 'reconnecting'
  }
  if (value.includes('connect')) return 'connected'
  return null
}

export default function RealtimeInterview({
  credentials,
  onConnectionState,
  onMeetingChange,
  onJoinedChange,
}) {
  const [meeting, initMeeting] = useRealtimeKitClient({ resetOnLeave: true })
  const interviewT = useLanguage(INTERVIEW_KO_DICTIONARY)
  const [initError, setInitError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const initializedAttemptRef = useRef('')
  const mountedRef = useRef(false)
  const renderedMeetingRef = useRef(null)

  // Connected-meeting transitions intentionally set the hook value to
  // undefined for 100ms. Retaining the prior client keeps RtkMeeting mounted;
  // otherwise leaveOnUnmount would call leave() in the middle of the transfer.
  if (meeting) renderedMeetingRef.current = meeting
  const renderedMeeting = meeting ?? renderedMeetingRef.current

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const token = credentials?.authToken
    if (!token) return
    const attemptKey = `${token}:${attempt}`
    if (initializedAttemptRef.current === attemptKey) return
    initializedAttemptRef.current = attemptKey
    setInitError('')
    onConnectionState?.('connecting')

    const initPromise = initMeeting({
      authToken: token,
      defaults: {
        audio: true,
        video: true,
        autoSwitchAudioDevice: true,
      },
      overrides: {
        disableSimulcast: false,
        simulcastConfig: { disable: false },
      },
      onError: (error) => {
        if (!mountedRef.current) return
        setInitError(safeMeetingError(error))
      },
    })

    void initPromise
      .then((client) => {
        if (!client) throw new Error('meeting_init_failed')
        if (!mountedRef.current) {
          void client.leave().catch(() => {})
          return
        }
        onConnectionState?.('ready')
      })
      .catch((error) => {
        if (!mountedRef.current) return
        initializedAttemptRef.current = ''
        setInitError(safeMeetingError(error))
        onConnectionState?.('failed')
      })
  }, [attempt, credentials?.authToken, initMeeting, onConnectionState])

  useEffect(() => {
    if (!meeting) return

    onMeetingChange?.(meeting)

    const handleConnection = (event) => {
      const state = connectionStateFromEvent(event)
      if (state) onConnectionState?.(state)
    }
    const handleRoomJoined = () => {
      onJoinedChange?.(true)
      onConnectionState?.('connected')
    }
    const handleRoomLeft = () => {
      onJoinedChange?.(false)
      onConnectionState?.('left')
    }

    onJoinedChange?.(Boolean(meeting.self?.roomJoined))

    meeting.meta?.on?.('socketConnectionUpdate', handleConnection)
    meeting.meta?.on?.('mediaConnectionUpdate', handleConnection)
    meeting.self?.on?.('roomJoined', handleRoomJoined)
    meeting.self?.on?.('roomLeft', handleRoomLeft)
    return () => {
      meeting.meta?.removeListener?.('socketConnectionUpdate', handleConnection)
      meeting.meta?.removeListener?.('mediaConnectionUpdate', handleConnection)
      meeting.self?.removeListener?.('roomJoined', handleRoomJoined)
      meeting.self?.removeListener?.('roomLeft', handleRoomLeft)
    }
  }, [meeting, onConnectionState, onJoinedChange, onMeetingChange])

  const retry = useCallback(() => {
    initializedAttemptRef.current = ''
    setAttempt((value) => value + 1)
  }, [])

  if (initError && !renderedMeeting) {
    return (
      <div className="interview-meeting-failure" role="alert">
        <span className="interview-state-symbol" aria-hidden="true">!</span>
        <h2>화상 면접에 연결하지 못했습니다.</h2>
        <p>{initError}</p>
        <button type="button" className="interview-primary-button" onClick={retry}>
          다시 시도
        </button>
      </div>
    )
  }

  if (!renderedMeeting) {
    return (
      <div className="interview-meeting-loading" role="status">
        <span className="interview-spinner" aria-hidden="true" />
        <p>화상 연결을 준비하는 중입니다.</p>
      </div>
    )
  }

  return (
    <div className="interview-meeting-stage">
      {initError && <p className="interview-connection-warning" role="status">{initError}</p>}
      <RtkMeeting
        {...INTERVIEW_MEETING_UI_PROPS}
        meeting={renderedMeeting}
        t={interviewT}
        mode="fill"
        showSetupScreen={true}
        leaveOnUnmount={true}
      />
    </div>
  )
}
