import { useAuth } from '../context/AuthContext.jsx'

export default function ChatMessageList({ messages }) {
  const { user } = useAuth()

  return (
    <div className="chat-message-list">
      {messages.map((m) => (
        <div key={m.id} className={m.senderId === user.id ? 'chat-message mine' : 'chat-message'}>
          <span className="chat-sender">{m.senderName}</span>
          <p>{m.body}</p>
        </div>
      ))}
    </div>
  )
}
