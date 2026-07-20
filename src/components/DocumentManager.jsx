import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client.js'

const LABELS = { resume: '이력서', cover_letter: '자기소개서' }
const DOC_TYPES = ['resume', 'cover_letter']

export default function DocumentManager() {
  const [docs, setDocs] = useState([])
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState('')

  const load = useCallback(async () => {
    const data = await api.get('/documents/mine')
    setDocs(data.documents)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleUpload = async (docType, file) => {
    if (!file) return
    setError('')
    setUploading(docType)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('docType', docType)
      await api.upload('/documents/upload', formData)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading('')
    }
  }

  const handleDelete = async (id) => {
    try {
      await api.delete(`/documents/${id}`)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  const docFor = (type) => docs.find((d) => d.docType === type)

  return (
    <div className="document-manager">
      <h2>내 서류</h2>
      {error && <p className="error">{error}</p>}
      {DOC_TYPES.map((type) => {
        const doc = docFor(type)
        return (
          <div key={type} className="document-row">
            <span className="document-label">{LABELS[type]}</span>
            {doc ? (
              <>
                <a href={`/api/documents/${doc.id}/download`} target="_blank" rel="noreferrer">
                  {doc.filename}
                </a>
                <button type="button" onClick={() => handleDelete(doc.id)}>
                  삭제
                </button>
              </>
            ) : (
              <span>업로드된 파일 없음</span>
            )}
            <label className="upload-button">
              {uploading === type ? '업로드 중...' : '파일 선택'}
              <input
                type="file"
                accept=".pdf,.doc,.docx,.hwp,.hwpx"
                disabled={uploading === type}
                onChange={(e) => handleUpload(type, e.target.files[0])}
                hidden
              />
            </label>
          </div>
        )
      })}
    </div>
  )
}
