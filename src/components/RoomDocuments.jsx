const LABELS = { resume: '이력서', cover_letter: '자기소개서' }

// 서류 목록은 면접방 화면이 한 번의 요청으로 함께 받아 온다.
export default function RoomDocuments({ documents = [] }) {
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
