import { useEffect, useState, useCallback, useRef } from 'react'
import { api, downloadApiFile } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'

const LABELS = { resume: '이력서', cover_letter: '자기소개서' }
const DOC_TYPES = ['resume', 'cover_letter']

export default function DocumentManager() {
  const toast = useToast()
  const [docs, setDocs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [changing, setChanging] = useState('')
  const [changeNotice, setChangeNotice] = useState('')
  const mounted = useRef(false)
  const lifetime = useRef(0)
  const generation = useRef(0)
  const trusted = useRef(false)
  const writing = useRef(false)

  const load = useCallback(async () => {
    if (!mounted.current) return null
    const current = ++generation.current
    const isCurrent = () => mounted.current && generation.current === current
    trusted.current = false
    setLoading(true)
    setLoadError('')
    try {
      const data = await api.get('/documents/mine')
      if (!isCurrent()) return null
      if (!Array.isArray(data?.documents)) throw new Error('목록 응답을 확인할 수 없습니다.')
      setDocs(data.documents)
      trusted.current = true
      return true
    } catch (err) {
      if (!isCurrent()) return null
      setLoadError(`서류 목록을 불러오지 못했습니다. ${err.message}`)
      return false
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    lifetime.current += 1
    void load()
    return () => {
      mounted.current = false
      lifetime.current += 1
      generation.current += 1
      trusted.current = false
      writing.current = false
    }
  }, [load])

  const change = async (key, action, successMessage) => {
    // Refs also stop duplicate/cross-document writes before disabled UI commits.
    if (!mounted.current || writing.current || !trusted.current) return
    writing.current = true
    trusted.current = false
    const current = lifetime.current
    const isCurrent = () => mounted.current && lifetime.current === current
    setChanging(key)
    setChangeNotice('')
    try {
      await action()
      if (!isCurrent()) return
      setChangeNotice(successMessage)
      toast.success(successMessage)
      // A confirmed mutation stays successful even if the following read fails.
      const refreshed = await load()
      if (isCurrent() && refreshed === false) toast.info('변경은 완료되었지만 서류 목록을 갱신하지 못했습니다. 목록을 다시 불러와 확인해주세요.')
    } catch (err) {
      if (!isCurrent()) return
      setLoadError('변경 결과를 확인하지 못했습니다. 목록을 다시 불러온 뒤 추가 변경을 진행해주세요.')
      toast.error(err.message)
    } finally {
      if (isCurrent()) { writing.current = false; setChanging('') }
    }
  }

  const handleUpload = (docType, file) => {
    if (!file) return
    return change(`upload:${docType}`, () => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('docType', docType)
      return api.upload('/documents/upload', formData)
    }, `${LABELS[docType]} 업로드가 완료되었습니다.`)
  }

  const handleDelete = id => change(`delete:${id}`, () => api.delete(`/documents/${id}`), '파일이 삭제되었습니다.')
  const retry = () => { if (!writing.current) return load() }
  const docFor = type => docs?.find(doc => doc.docType === type)
  const disabled = loading || !!loadError || docs === null || !!changing

  return (
    <div className="document-manager">
      <h2>내 서류</h2>
      {changeNotice && <p className="notice" role="status">{changeNotice}</p>}
      {loading && <p role="status">서류 목록을 불러오는 중...</p>}
      {loadError && <p className="error" role="alert">{loadError}</p>}
      {docs !== null && (loading || loadError || changing) && <p className="notice">이전에 불러온 서류 목록입니다. 최신 목록을 확인하기 전에는 추가 업로드·삭제를 할 수 없습니다.</p>}
      {loadError && <button type="button" className="btn-sm" disabled={loading || !!changing} onClick={retry}>서류 목록 다시 불러오기</button>}
      {DOC_TYPES.map((type) => {
        const doc = docFor(type)
        const inputId = `document-upload-${type}`
        return (
          <div key={type} className="document-row">
            <span className="document-label">{LABELS[type]}</span>
            {doc ? (
              <>
                <button
                  type="button"
                  className="document-download-link"
                  disabled={disabled}
                  onClick={() => {
                    if (!trusted.current || writing.current) return
                    const current = lifetime.current
                    void downloadApiFile(`/documents/${doc.id}/download`).catch(err => {
                      if (mounted.current && lifetime.current === current) toast.error(err.message)
                    })
                  }}
                >
                  {doc.filename}
                </button>
                <button type="button" className="btn-danger btn-sm" disabled={disabled} onClick={() => handleDelete(doc.id)}>
                  {changing === `delete:${doc.id}` ? '삭제 중...' : '삭제'}
                </button>
              </>
            ) : (
              <span>{docs === null || loading || loadError || changing ? '목록 확인 필요' : '업로드된 파일 없음'}</span>
            )}
            <label className="upload-button" htmlFor={inputId}>
              {changing === `upload:${type}` ? '업로드 중...' : '파일 선택'}
              <input
                id={inputId}
                type="file"
                className="sr-only"
                accept=".pdf,.doc,.docx,.hwp,.hwpx"
                disabled={disabled}
                onChange={event => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  return handleUpload(type, file)
                }}
              />
            </label>
          </div>
        )
      })}
    </div>
  )
}
