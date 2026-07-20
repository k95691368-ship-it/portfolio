import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { useChatPolling } from '../hooks/useChatPolling.js'
import ChatMessageList from '../components/ChatMessageList.jsx'
import ChatComposer from '../components/ChatComposer.jsx'
import RoomDocuments from '../components/RoomDocuments.jsx'
import ContractFieldsForm from '../components/ContractFieldsForm.jsx'

export default function RoomPage() {
  const { roomId } = useParams()
  const [room, setRoom] = useState(null)
  const [error, setError] = useState('')
  const { messages, sendMessage } = useChatPolling(roomId)

  const [contract, setContract] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState('')

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
    setAnalyzeError('')
    setAnalyzing(true)
    try {
      const data = await api.post(`/rooms/${roomId}/analyze`, {})
      setContract(data)
    } catch (err) {
      setAnalyzeError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!room) return <p>불러오는 중...</p>

  return (
    <div className="room-page">
      <header>
        <Link to="/dashboard">← 대시보드</Link>
        <h1>{room.title}</h1>
        <p>참가자: {room.participants.map((p) => p.displayName).join(', ')}</p>
        {room.myRole === 'company' && <p>초대코드: {room.inviteCode}</p>}
      </header>

      <RoomDocuments roomId={roomId} />

      <ChatMessageList messages={messages} />
      <ChatComposer onSend={sendMessage} />

      <section className="ai-analysis">
        <h2>채용 조건 분석</h2>
        <button type="button" onClick={handleAnalyze} disabled={analyzing}>
          {analyzing ? '분석 중...' : 'AI로 조건 정리하기'}
        </button>
        {analyzeError && <p className="error">{analyzeError}</p>}
        <ContractFieldsForm
          terms={contract?.terms}
          hireConfirmed={contract?.hireConfirmed}
          confirmationExcerpt={contract?.confirmationExcerpt}
        />
      </section>
    </div>
  )
}
