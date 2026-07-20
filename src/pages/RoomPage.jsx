import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { useChatPolling } from '../hooks/useChatPolling.js'
import ChatMessageList from '../components/ChatMessageList.jsx'
import ChatComposer from '../components/ChatComposer.jsx'

export default function RoomPage() {
  const { roomId } = useParams()
  const [room, setRoom] = useState(null)
  const [error, setError] = useState('')
  const { messages, sendMessage } = useChatPolling(roomId)

  useEffect(() => {
    api
      .get(`/rooms/${roomId}`)
      .then(setRoom)
      .catch((err) => setError(err.message))
  }, [roomId])

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

      <ChatMessageList messages={messages} />
      <ChatComposer onSend={sendMessage} />
    </div>
  )
}
