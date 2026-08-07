import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useChatPolling } from '../hooks/useChatPolling.js'
import ChatMessageList from '../components/ChatMessageList.jsx'
import ChatComposer from '../components/ChatComposer.jsx'
import RoomDocuments from '../components/RoomDocuments.jsx'
import ContractFieldsForm from '../components/ContractFieldsForm.jsx'
import FinalOfferEmailForm from '../components/FinalOfferEmailForm.jsx'
import RoomInviteEmailForm from '../components/RoomInviteEmailForm.jsx'
import InterviewSummary from '../components/InterviewSummary.jsx'
import { roomStatusInfo } from '../lib/roomStatus.js'

// 전형을 왜 끝냈는지. 지원자에게는 사유마다 전혀 다른 의미다.
const CLOSE_REASONS = [
  { value: 'other_candidate', label: '다른 지원자를 채용했습니다' },
  { value: 'candidate_withdrew', label: '지원자가 전형을 그만두었습니다' },
  { value: 'position_cancelled', label: '채용 자체가 취소되었습니다' },
  { value: 'terms_not_agreed', label: '근로조건에 합의하지 못했습니다' },
  { value: 'other', label: '그 밖의 사유' },
]

export default function RoomPage() {
  const { roomId } = useParams()
  const toast = useToast()
  const { user } = useAuth()
  const [view, setView] = useState(null)
  const [error, setError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeReason, setCloseReason] = useState('other_candidate')
  const [closeNote, setCloseNote] = useState('')

  // 이 화면에 필요한 모든 정보를 한 번의 요청으로 받는다.
  const loadView = useCallback(async () => {
    const data = await api.get(`/rooms/${roomId}/view`)
    setView(data)
    return data
  }, [roomId])

  const handleClose = async () => {
    if (!window.confirm('이 전형을 종료하시겠습니까? 지원자에게 종료 사실과 사유가 안내됩니다.')) return
    setClosing(true)
    try {
      await api.post(`/rooms/${roomId}/close`, { reason: closeReason, note: closeNote })
      await loadView()
      toast.success('전형을 종료했습니다. 지원자에게 안내되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setClosing(false)
    }
  }

  const handleReopen = async () => {
    setClosing(true)
    try {
      await api.delete(`/rooms/${roomId}/close`)
      await loadView()
      toast.success('전형을 다시 진행합니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setClosing(false)
    }
  }

  useEffect(() => {
    setView(null)
    setError('')
    loadView().catch((err) => setError(err.message))
  }, [loadView])

  // 대화의 첫 묶음은 위 요청에 이미 들어 있다. 그다음부터만 증분으로 확인한다.
  const { messages, sendMessage } = useChatPolling(roomId, 2500, view?.messages ?? null)

  const handleAnalyze = async () => {
    setAnalyzing(true)
    try {
      const data = await api.post(`/rooms/${roomId}/analyze`, {})
      setView((prev) => (prev ? { ...prev, contract: data } : prev))
      toast.success('채용 조건이 정리되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!view) return <p>불러오는 중...</p>

  const room = view.room
  const contract = view.contract
  const candidate = room.participants.find((participant) => participant.role === 'candidate')
  const company = room.participants.find((participant) => participant.role === 'company')

  return (
    <div className="room-page">
      <header className="page-header">
        <Link to="/dashboard" className="back-link">
          ← 대시보드
        </Link>
        <h1>{room.title}</h1>
        <p>참가자: {room.participants.map((p) => p.displayName).join(', ')}</p>
        {room.myRole === 'company' && <p>초대코드: {room.inviteCode}</p>}
        <span className={`badge ${roomStatusInfo(room.status).badgeClass}`}>
          {roomStatusInfo(room.status).label}
        </span>
      </header>

      {/* 끝난 전형이 "진행중"으로 남아 있으면 지원자는 계속 기다린다. */}
      {room.status === 'closed' && (
        <div className="room-closed" role="status">
          <p className="period-alert">
            이 전형은 종료되었습니다.{room.closeReason && ` 사유: ${room.closeReason}`}
          </p>
          <p className="period-detail">
            지금까지의 대화와 계약 조건은 그대로 볼 수 있습니다. 계약을 진행하는 작업만 막혀 있습니다.
          </p>
          {room.myRole === 'company' && (
            <button type="button" className="btn-sm" onClick={handleReopen} disabled={closing}>
              전형 다시 진행하기
            </button>
          )}
        </div>
      )}

      <RoomDocuments documents={view.documents} />

      <div className="chat-panel">
        <ChatMessageList messages={messages} />
        {room.myRole === 'admin' ? (
          <p className="notice">관리자 열람 모드입니다. 채팅 작성은 참여자만 가능합니다.</p>
        ) : (
          <ChatComposer onSend={sendMessage} />
        )}
      </div>

      <section className="ai-analysis">
        <h2>채용 조건 분석</h2>
        {/* 체결이 끝난 계약의 조건을 다시 정리하면 근로자가 보는 근로조건이
            바뀐다. 서버에서도 막지만 버튼부터 내린다. */}
        {room.myRole === 'company' && room.status !== 'signed' && (
          <button type="button" className="btn-primary" onClick={handleAnalyze} disabled={analyzing}>
            {analyzing ? '분석 중...' : 'AI로 조건 정리하기'}
          </button>
        )}
        {room.myRole === 'company' && room.status === 'signed' && (
          <p className="notice">
            서명이 완료된 계약이라 조건을 다시 정리할 수 없습니다. 변경이 필요하면 새 계약을
            체결해주세요.
          </p>
        )}
        <ContractFieldsForm
          terms={contract?.terms}
          hireConfirmed={contract?.hireConfirmed}
          confirmationExcerpt={contract?.confirmationExcerpt}
        />
        {contract?.terms?.analysisWarnings?.length > 0 && (
          <div className="ai-warnings">
            <h3>⚠️ AI 법적 검토 경고</h3>
            {contract.terms.analysisWarnings.map((w, i) => (
              <p key={i} className="error">
                {w}
              </p>
            ))}
          </div>
        )}
        <p>
          <Link to={`/rooms/${roomId}/contract`}>
            {room.myRole === 'company' ? '전자근로계약서 작성하러 가기 →' : '전자근로계약서 확인·서명하러 가기 →'}
          </Link>
        </p>
      </section>

      {room.myRole === 'company' && (
        <InterviewSummary
          roomId={roomId}
          record={view.interviewSummary}
          canWrite={!!(user?.isAdmin || user?.isRecruiter)}
          messageCount={messages.length}
          onChanged={loadView}
        />
      )}

      {room.myRole === 'company' && (
        <>
          <RoomInviteEmailForm
            roomId={roomId}
            initial={view.inviteEmail}
            candidateName={candidate?.displayName || '지원자'}
            companyName={company?.companyName || company?.displayName || '회사'}
          />
          <FinalOfferEmailForm
            roomId={roomId}
            initial={view.finalOfferEmail}
            candidateName={candidate?.displayName || '지원자'}
            companyName={company?.companyName || company?.displayName || '회사'}
          />
        </>
      )}
    </div>
  )
}
