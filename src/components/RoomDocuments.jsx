import { useEffect, useState } from 'react'
import { api } from '../api/client.js'

const LABELS = { resume: '이력서', cover_letter: '자기소개서' }

export default function RoomDocuments({ roomId }) {
  const [documents, setDocuments] = useState([])

  useEffect(() => {
    api
      .get(`/rooms/${roomId}/documents`)
      .then((data) => setDocuments(data.documents))
      .catch(() => setDocuments([]))
  }, [roomId])

  if (documents.length === 0) return null

  return (
    <div className="room-documents">
      <h2>제출 서류</h2>
      <ul>
        {documents.map((doc) => (
          <li key={doc.id}>
            {LABELS[doc.docType] || doc.docType}:{' '}
            <a href={`/api/documents/${doc.id}/download`} target="_blank" rel="noreferrer">
              {doc.filename}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
