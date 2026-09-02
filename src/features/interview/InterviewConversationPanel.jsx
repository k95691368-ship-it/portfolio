import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useChatPolling } from '../../hooks/useChatPolling.js'
import { formatKstTime } from '../../lib/formatTime.js'
import {
  isInterviewStaff,
  privateMessagePeerIds,
  privateMessageSenderIds,
  privateTextMessages,
  publicChatParticipants,
} from './collaborationModel.js'

const EMPTY_MESSAGES = []

function MessageLog({ messages, viewerId, emptyText }) {
  const logRef = useRef(null)

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages])

  return (
    <div
      ref={logRef}
      className="interview-conversation-log"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
    >
      {messages.length === 0 && (
        <p className="interview-conversation-empty">{emptyText}</p>
      )}
      {messages.map((message) => {
        const mine = message.senderId === viewerId
        return (
          <article
            key={message.id}
            className={`interview-conversation-message${mine ? ' is-mine' : ''}`}
          >
            <div className="interview-conversation-message__meta">
              <strong>{message.senderName}</strong>
              <time dateTime={message.createdAt}>{formatKstTime(message.createdAt)}</time>
            </div>
            <p>{message.body}</p>
          </article>
        )
      })}
    </div>
  )
}

export default function InterviewConversationPanel({
  open,
  onClose,
  roomId,
  session,
  meeting,
}) {
  const staffView = isInterviewStaff(session.myRole)
  const [activeTab, setActiveTab] = useState('public')
  const [publicDraft, setPublicDraft] = useState('')
  const [privateDraft, setPrivateDraft] = useState('')
  const [publicBusy, setPublicBusy] = useState(false)
  const [publicSendError, setPublicSendError] = useState('')
  const [privateBusy, setPrivateBusy] = useState(false)
  const [privateError, setPrivateError] = useState('')
  const [privateMessages, setPrivateMessages] = useState([])
  const [joinedParticipants, setJoinedParticipants] = useState([])
  const {
    messages: publicMessages,
    error: publicError,
    sendMessage,
  } = useChatPolling(roomId, 2500, EMPTY_MESSAGES, {
    viewerId: session.viewerUserId,
    interviewSessionId: session.id,
  })

  const participants = useMemo(
    () => publicChatParticipants(session.members),
    [session.members]
  )
  const participantById = useMemo(
    () => new Map(participants.map((participant) => [participant.id, participant])),
    [participants]
  )
  const publicDisplayMessages = useMemo(
    () =>
      publicMessages.map((message) => ({
        ...message,
        senderName:
          message.senderName || participantById.get(message.senderId)?.displayName || '참가자',
      })),
    [participantById, publicMessages]
  )

  useEffect(() => {
    if (!staffView) {
      setActiveTab('public')
      setPrivateMessages([])
      setJoinedParticipants([])
      return undefined
    }
    if (!meeting) return undefined

    const refreshPrivateState = () => {
      const connected = meeting.participants?.joined?.toArray?.() ?? []
      const allowedSenders = privateMessageSenderIds(
        session.members,
        connected,
        meeting.self
      )
      setJoinedParticipants(connected)
      setPrivateMessages(
        privateTextMessages(meeting.chat?.messages ?? [], allowedSenders)
      )
    }

    refreshPrivateState()
    meeting.chat?.on?.('chatUpdate', refreshPrivateState)
    meeting.participants?.joined?.on?.('participantJoined', refreshPrivateState)
    meeting.participants?.joined?.on?.('participantLeft', refreshPrivateState)
    meeting.participants?.joined?.on?.('participantsCleared', refreshPrivateState)
    return () => {
      meeting.chat?.removeListener?.('chatUpdate', refreshPrivateState)
      meeting.participants?.joined?.removeListener?.('participantJoined', refreshPrivateState)
      meeting.participants?.joined?.removeListener?.('participantLeft', refreshPrivateState)
      meeting.participants?.joined?.removeListener?.('participantsCleared', refreshPrivateState)
    }
  }, [meeting, session.members, staffView])

  const privatePeerIds = useMemo(
    () => privateMessagePeerIds(session.members, joinedParticipants, meeting?.self),
    [joinedParticipants, meeting?.self, session.members]
  )

  const submitPublic = async (event) => {
    event.preventDefault()
    const text = publicDraft.trim()
    if (!text || publicBusy) return
    setPublicBusy(true)
    setPublicSendError('')
    try {
      await sendMessage(text)
      setPublicDraft('')
    } catch (error) {
      setPublicSendError(error.message)
    } finally {
      setPublicBusy(false)
    }
  }

  const submitPrivate = async (event) => {
    event.preventDefault()
    const text = privateDraft.trim()
    if (!staffView || !text || privateBusy) return
    if (!meeting?.chat?.sendTextMessage || privatePeerIds.length === 0) {
      setPrivateError('현재 연결된 다른 면접관이 없습니다.')
      return
    }

    setPrivateBusy(true)
    setPrivateError('')
    try {
      await meeting.chat.sendTextMessage(text, [...privatePeerIds])
      setPrivateDraft('')
    } catch {
      setPrivateError('면접관 대화를 보내지 못했습니다. 연결 상태를 확인해주세요.')
    } finally {
      setPrivateBusy(false)
    }
  }

  return (
    <aside
      className="interview-conversation-panel"
      aria-label="면접 대화"
      hidden={!open}
    >
      <div className="interview-conversation-panel__header">
        <div>
          <strong>대화</strong>
          {staffView && activeTab === 'private' && <span>면접관만 표시</span>}
        </div>
        <button type="button" onClick={onClose} aria-label="대화 닫기">×</button>
      </div>

      {staffView && (
        <div className="interview-conversation-tabs" role="tablist" aria-label="대화 구분">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'public'}
            onClick={() => setActiveTab('public')}
          >
            공개 대화
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'private'}
            onClick={() => setActiveTab('private')}
          >
            면접관 대화
          </button>
        </div>
      )}

      {activeTab === 'public' || !staffView ? (
        <>
          <MessageLog
            messages={publicDisplayMessages}
            viewerId={session.viewerUserId}
            emptyText="아직 공개 대화가 없습니다."
          />
          <form className="interview-conversation-composer" onSubmit={submitPublic}>
            <label htmlFor="interview-public-message">공개 메시지</label>
            <textarea
              id="interview-public-message"
              value={publicDraft}
              onChange={(event) => setPublicDraft(event.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="모든 참가자에게 보낼 메시지"
            />
            <button type="submit" disabled={publicBusy || !publicDraft.trim()}>
              {publicBusy ? '보내는 중…' : '보내기'}
            </button>
          </form>
          {(publicSendError || publicError) && (
            <p className="interview-conversation-error" role="alert">
              {publicSendError || publicError}
            </p>
          )}
        </>
      ) : (
        <>
          <MessageLog
            messages={privateMessages}
            viewerId={meeting?.self?.userId}
            emptyText="아직 면접관 대화가 없습니다."
          />
          <form className="interview-conversation-composer" onSubmit={submitPrivate}>
            <label htmlFor="interview-private-message">면접관 메시지</label>
            <textarea
              id="interview-private-message"
              value={privateDraft}
              onChange={(event) => setPrivateDraft(event.target.value)}
              maxLength={Math.min(Number(meeting?.chat?.maxTextLimit) || 2000, 2000)}
              rows={2}
              placeholder="연결된 면접관에게만 보낼 메시지"
            />
            <button type="submit" disabled={privateBusy || !privateDraft.trim()}>
              {privateBusy ? '보내는 중…' : '보내기'}
            </button>
          </form>
          {privatePeerIds.length === 0 && !privateError && (
            <p className="interview-conversation-note" role="status">
              현재 연결된 다른 면접관이 없습니다.
            </p>
          )}
          {privateError && (
            <p className="interview-conversation-error" role="alert">{privateError}</p>
          )}
        </>
      )}
    </aside>
  )
}
