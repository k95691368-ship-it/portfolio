import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { useChatPolling } from '../hooks/useChatPolling.js'
import ChatMessageList from '../components/ChatMessageList.jsx'
import ChatComposer from '../components/ChatComposer.jsx'
import RoomDocuments from '../components/RoomDocuments.jsx'
import ContractFieldsForm from '../components/ContractFieldsForm.jsx'
import FinalOfferEmailForm from '../components/FinalOfferEmailForm.jsx'
import RoomInviteEmailForm from '../components/RoomInviteEmailForm.jsx'

export default function RoomPage() {
  const { roomId } = useParams()
  const toast = useToast()
  const [room, setRoom] = useState(null)
  const [error, setError] = useState('')
  const { messages, sendMessage } = useChatPolling(roomId)

  const [contract, setContract] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)

  const loadContract = useCallback(async () => {
    const data = await api.get(`/rooms/${roomId}/contract`)
    setContract(data)
  }, [roomId])

  useEffect(() => {
    api
      .get(`/rooms/${roomId}`)
      .then(setRoom)
      .catch((err) => setError(err.message))
    loadContract().catch(() => {})
  }, [roomId, loadContract])

  const handleAnalyze = async () => {
    setAnalyzing(true)
    try {
      const data = await api.post(`/rooms/${roomId}/analyze`, {})
      setContract(data)
      toast.success('채용 조건이 정리되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!room) return <p>불러오는 중...</p>

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
      </header>

      <RoomDocuments roomId={roomId} />

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
        {room.myRole === 'company' && (
          <>
            <button type="button" className="btn-primary" onClick={handleAnalyze} disabled={analyzing}>
              {analyzing ? '분석 중...' : 'AI로 조건 정리하기'}
            </button>
          </>
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
        <>
          <RoomInviteEmailForm
            roomId={roomId}
            candidateName={candidate?.displayName || '지원자'}
            companyName={company?.companyName || company?.displayName || '회사'}
          />
          <FinalOfferEmailForm
            roomId={roomId}
            candidateName={candidate?.displayName || '지원자'}
            companyName={company?.companyName || company?.displayName || '회사'}
          />
        </>
      )}
    </div>
  )
}
