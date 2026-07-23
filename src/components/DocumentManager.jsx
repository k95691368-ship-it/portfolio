import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'

const LABELS = { resume: '이력서', cover_letter: '자기소개서' }
const DOC_TYPES = ['resume', 'cover_letter']

export default function DocumentManager() {
  const toast = useToast()
  const [docs, setDocs] = useState([])
  const [uploading, setUploading] = useState('')

  const load = useCallback(async () => {
    const data = await api.get('/documents/mine')
    setDocs(data.documents)
  }, [])

  useEffect(() => {
    load().catch((err) => toast.error(err.message))
  }, [load, toast])

  const handleUpload = async (docType, file) => {
    if (!file) return
    setUploading(docType)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('docType', docType)
      await api.upload('/documents/upload', formData)
      await load()
      toast.success(`${LABELS[docType]}이(가) 업로드되었습니다.`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setUploading('')
    }
  }

  const handleDelete = async (id) => {
    try {
      await api.delete(`/documents/${id}`)
      await load()
      toast.success('파일이 삭제되었습니다.')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const docFor = (type) => docs.find((d) => d.docType === type)

  return (
    <div className="document-manager">
      <h2>내 서류</h2>
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
                <button type="button" className="btn-danger btn-sm" onClick={() => handleDelete(doc.id)}>
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
                className="sr-only"
                accept=".pdf,.doc,.docx,.hwp,.hwpx"
                disabled={uploading === type}
                onChange={(e) => handleUpload(type, e.target.files?.[0])}
              />
            </label>
          </div>
        )
      })}
    </div>
  )
}
