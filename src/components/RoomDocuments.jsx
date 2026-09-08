import { useState } from 'react'
import { downloadApiFile } from '../api/client.js'

const LABELS = { resume: '이력서', cover_letter: '자기소개서' }

// 서류 목록은 면접방 화면이 한 번의 요청으로 함께 받아 온다.
export default function RoomDocuments({ documents = [] }) {
  const [error, setError] = useState('')
  if (documents.length === 0) return null

  return (
    <div className="room-documents">
      <h2>제출 서류</h2>
      <ul>
        {documents.map((doc) => (
          <li key={doc.id}>
            {LABELS[doc.docType] || doc.docType}:{' '}
            <button
              type="button"
              className="document-download-link"
              onClick={() => {
                setError('')
                void downloadApiFile(`/documents/${doc.id}/download`).catch((caught) => setError(caught.message))
              }}
            >
              {doc.filename}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  )
}
