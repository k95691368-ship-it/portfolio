import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatKstDate, formatKst } from '../lib/formatTime.js'
import { Link } from 'react-router-dom'
import { api, downloadApiFile, markRoomDoor } from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCreateRequest } from '../hooks/useCreateRequest.js'
import NotificationBell from '../components/NotificationBell.jsx'
import ApplicantCompare from '../components/ApplicantCompare.jsx'
import ApplicationResultEmailStatus from '../components/ApplicationResultEmailStatus.jsx'
import Modal from '../components/Modal.jsx'
import UnsavedChangesGuard from '../components/UnsavedChangesGuard.jsx'
import PostingEditor from '../components/PostingEditor.jsx'
import PostingQrModal from '../components/PostingQrModal.jsx'
import { EXAMPLE_POSTING } from '../../shared/jobPostingTemplate.js'

// 공고 등록 폼의 빈 상태. 한 곳에만 두어, 등록 후 초기화에서 필드를 빠뜨리는 일을 막는다.
const EMPTY_POSTING = {
  title: '',
  department: '',
  employmentType: '',
  location: '',
  deadline: '',
  description: '',
  wageType: '',
  wageMin: '',
  wageMax: '',
  workHoursStart: '',
  workHoursEnd: '',
  workDays: '',
}

const STATUS_LABEL = {
  submitted: { label: '심사 대기', badge: 'badge-warning' },
  passed: { label: '서류합격', badge: 'badge-success' },
  rejected: { label: '불합격', badge: 'badge-danger' },
  withdrawn: { label: '지원 철회', badge: 'badge-neutral' },
}

const FIT_LABEL = {
  high: { label: '적합도 높음', badge: 'badge-success' },
  medium: { label: '적합도 보통', badge: 'badge-warning' },
  low: { label: '적합도 낮음', badge: 'badge-danger' },
  unknown: { label: '판단 보류', badge: 'badge-neutral' },
}

export function ApplicationDetail({ appId, onClose, onChanged, canPass }) {
  const toast = useToast()
  const [detail, setDetail] = useState(null)
  const [working, setWorking] = useState(false)
  const [passResult, setPassResult] = useState(null)
  const [screening, setScreening] = useState(null)
  const [screeningLoading, setScreeningLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [detailLoading, setDetailLoading] = useState(true)

  const load = useCallback(() => {
    setLoadError('')
    setDetailLoading(true)
    return api
      .get(`/applications/${appId}`)
      .then((data) => {
        setDetail(data.application)
        setScreening(data.application.aiScreening)
      })
      .catch((err) => setLoadError(err.message || '지원서를 불러오지 못했습니다.'))
      .finally(() => setDetailLoading(false))
  }, [appId])

  const handleScreen = async () => {
    setScreeningLoading(true)
    try {
      const data = await api.post(`/applications/${appId}/screen`, { revision: detail?.revision ?? 0 })
      setScreening(data.screening)
      toast.success('AI 서류 검토가 완료되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setScreeningLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [load])

  const notifyResultEmail = (result, outcome = '') => {
    const status = result?.resultEmail?.status || result?.emailStatus || 'unknown'
    const prefix = outcome ? `${outcome} 처리되었습니다. ` : ''
    if (status === 'sent') {
      toast.success(`${prefix}Gmail이 결과 안내 이메일을 접수했습니다.`)
    } else if (['failed', 'not_sent', 'not_configured'].includes(status)) {
      toast.error(`${prefix}결과 안내 이메일은 발송되지 않았습니다. 발송 상태와 설정을 확인해주세요.`)
    } else {
      toast.info(`${prefix}이메일 발송이 완료됐는지 아직 확인할 수 없습니다. 발송 상태를 확인하고 중복 전송하지 마세요.`)
    }
  }

  const refreshEmailStatus = async () => {
    if (working) return
    setWorking(true)
    try { await load() }
    finally { setWorking(false) }
  }

  const handlePass = async () => {
    if (working || !window.confirm('서류합격을 확정하시겠습니까? 지원자 계정과 면접방이 생성되고, 지원자에게 합격 결과와 면접방 입장 안내 이메일이 자동 발송됩니다.')) return
    setWorking(true)
    try {
      const result = await api.post(`/applications/${appId}/pass`, { revision: detail?.revision ?? 0 })
      setPassResult(result)
      setDetail((current) => ({ ...current, status: 'passed', resultEmail: result.resultEmail }))
      notifyResultEmail(result, '서류합격')
      await load()
      onChanged()
    } catch (err) {
      toast.error(err.message)
      await load()
    } finally {
      setWorking(false)
    }
  }

  const handleSendResultEmail = async () => {
    const email = detail?.resultEmail
    if (working || email?.canRetry !== true || !['pending', 'not_sent', 'failed'].includes(email.status)) return
    if (!window.confirm(`${detail.applicantName}님(${detail.applicantEmail})에게 서류 ${detail.status === 'passed' ? '합격' : '불합격'} 결과 안내 이메일을 실제로 발송하시겠습니까?`)) return
    setWorking(true)
    try {
      const result = await api.post(`/applications/${appId}/send-result-email`, {})
      setDetail((current) => ({ ...current, resultEmail: result.resultEmail }))
      notifyResultEmail(result)
      await load()
    } catch (err) {
      // A lost response is not proof of a failed send. Disable retry until a
      // successful detail lookup tells us the persisted delivery state.
      setDetail((current) => ({ ...current, resultEmail: { status: 'unknown', canRetry: false } }))
      toast.error(err.message)
      await load()
    } finally {
      setWorking(false)
    }
  }

  const handleReject = async () => {
    if (working || !window.confirm('서류 불합격을 확정하시겠습니까? 지원자에게 불합격 결과 안내 이메일이 자동 발송됩니다.')) return
    setWorking(true)
    try {
      const result = await api.post(`/applications/${appId}/reject`, { revision: detail?.revision ?? 0 })
      setDetail((current) => ({ ...current, status: 'rejected', resultEmail: result.resultEmail }))
      notifyResultEmail(result, '서류 불합격')
      await load()
      onChanged()
    } catch (err) {
      toast.error(err.message)
      await load()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Modal
      title={detail ? `${detail.applicantName} 지원서 상세` : '지원서 상세'}
      onClose={onClose}
      className="application-modal"
    >
      <>
        {loadError ? (
          <div>
            <p className="error" role="alert">지원서 상세를 불러오지 못했습니다. {loadError}</p>
            <button type="button" className="btn-secondary" onClick={load} disabled={working}>지원서 다시 불러오기</button>
          </div>
        ) : !detail || detailLoading ? (
          <p role="status">불러오는 중...</p>
        ) : (
          <>
            <div className="modal-head">
              <h2>지원서 상세</h2>
              <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
                닫기
              </button>
            </div>

            {passResult && (
              <div className="temp-password-banner">
                <p>
                  <strong>{detail.applicantName}</strong>님을 서류합격 처리했습니다. 면접방이 생성되었습니다.
                </p>
                {/* 지원자에게 건네야 하는 것은 비밀번호가 아니라 입장 코드다.
                    지원자에게는 로그인할 이유도, 로그인 화면으로 가는 길도 없다.
                    코드만 있으면 채용 공고 화면에서 바로 들어온다. */}
                <p>
                  면접방 입장 코드: <code>{passResult.inviteCode}</code>{' '}
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={() => navigator.clipboard?.writeText(passResult.inviteCode)}
                  >
                    복사
                  </button>
                </p>
                <p>
                  지원자는 채용 공고 화면에서 입장 코드를 입력해 면접방으로 들어올 수 있습니다.
                  이메일 처리 결과는 아래 발송 상태에서 확인해주세요.
                </p>
                {passResult.roomId && (
                  <p>
                    <Link
                      to={`/rooms/${passResult.roomId}`}
                      onClick={() => markRoomDoor(passResult.roomId, 'account')}
                    >
                      생성된 면접방으로 이동 →
                    </Link>
                  </p>
                )}
              </div>
            )}

            <dl className="application-fields">
              <dt>이름</dt>
              <dd>{detail.applicantName}</dd>
              <dt>이메일</dt>
              <dd>{detail.applicantEmail}</dd>
              <dt>연락처</dt>
              <dd>{detail.applicantPhone}</dd>
              <dt>지원 경로</dt>
              <dd>{detail.applicationSource || '-'}</dd>
              <dt>상태</dt>
              <dd>
                <span className={`badge ${STATUS_LABEL[detail.status]?.badge || 'badge-neutral'}`}>
                  {STATUS_LABEL[detail.status]?.label || detail.status}
                </span>
              </dd>
            </dl>

            {['passed', 'rejected'].includes(detail.status) && (
              <ApplicationResultEmailStatus
                resultEmail={detail.resultEmail}
                working={working}
                onRetry={handleSendResultEmail}
                onRefresh={refreshEmailStatus}
              />
            )}

            {detail.career.length > 0 && (
              <div className="application-block">
                <h3>경력사항</h3>
                {detail.career.map((c, i) => (
                  <div className="career-view" key={i}>
                    <strong>{c.companyName || '(회사명 미기재)'}</strong>
                    <span>
                      {[c.employmentType, c.position, c.department].filter(Boolean).join(' · ')}
                    </span>
                    <span>
                      {[c.startDate, c.current ? '재직 중' : c.endDate].filter(Boolean).join(' ~ ')}
                    </span>
                    {c.description && <p>{c.description}</p>}
                  </div>
                ))}
              </div>
            )}

            {detail.coverLetter && (
              <div className="application-block">
                <h3>자기소개 / 지원동기</h3>
                <p className="cover-letter-view">{detail.coverLetter}</p>
              </div>
            )}

            <div className="application-block">
              <h3>제출서류</h3>
              {detail.documents.length === 0 ? (
                <p>-</p>
              ) : (
                <ul className="doc-download-list">
                  {detail.documents.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className="document-download-link"
                        onClick={() => void downloadApiFile(`/applications/${appId}/doc/${d.id}`).catch((err) => toast.error(err.message))}
                      >
                        {d.docType === 'resume' ? '이력서' : '포트폴리오'}: {d.filename}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="application-block">
              <h3>개인정보 동의</h3>
              {/* 그림문자만 두면 "체크 표시 버튼"처럼 엉뚱하게 읽힌다.
                  동의 여부는 법적 근거가 되는 값이라 말로도 분명히 남긴다. */}
              <p>
                {[
                  ['필수', detail.consent.required],
                  ['선택', detail.consent.optional],
                  ['제3자 제공', detail.consent.thirdParty],
                ].map(([label, agreed], i) => (
                  <span key={label}>
                    {i > 0 && ' · '}
                    {label} <span aria-hidden="true">{agreed ? '✅' : '❌'}</span>
                    <span className="sr-only">{agreed ? '동의함' : '동의하지 않음'}</span>
                  </span>
                ))}
              </p>
            </div>

            <div className="application-block ai-screening">
              <div className="ai-screening-head">
                <h3>AI 서류 검토</h3>
                <button type="button" className="btn-sm" onClick={handleScreen} disabled={screeningLoading || detail.status !== 'submitted'}>
                  {screeningLoading ? 'AI가 검토하는 중...' : screening ? '다시 검토' : 'AI로 검토하기'}
                </button>
              </div>
              {screening ? (
                <>
                  <p>
                    <span className={`badge ${FIT_LABEL[screening.fit]?.badge || 'badge-neutral'}`}>
                      {FIT_LABEL[screening.fit]?.label || screening.fit}
                    </span>{' '}
                    <span className="screening-fit-reason">{screening.fitReason}</span>
                  </p>
                  <p className="screening-summary">{screening.summary}</p>
                  {screening.strengths.length > 0 && (
                    <div>
                      <strong>강점</strong>
                      <ul className="screening-list">
                        {screening.strengths.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {screening.concerns.length > 0 && (
                    <div>
                      <strong>확인 필요</strong>
                      <ul className="screening-list">
                        {screening.concerns.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {screening.interviewQuestions.length > 0 && (
                    <div>
                      <strong>추천 면접 질문</strong>
                      <ul className="screening-list">
                        {screening.interviewQuestions.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="notice">
                  AI가 공고 요건과 지원서를 비교해 요약·적합도·강점·확인사항·추천 면접 질문을 정리해줍니다.
                </p>
              )}
            </div>

            {/* 채용내정이 성립한 사람은 탈락시킬 수 없다.
                담당자가 이것을 모른 채 누르는 것을 막는 것이 이 시스템의 목적이므로,
                누르고 나서 거절하는 것이 아니라 누르기 전에 알린다. */}
            {detail.offer?.established && (
              <div className="offer-block-notice" role="alert">
                <p className="offer-block-title">
                  채용내정이 성립한 지원자입니다 — 탈락 처리할 수 없습니다.
                </p>
                {detail.offer.excerpt && (
                  <blockquote className="offer-excerpt">
                    <span className="offer-excerpt-label">성립 근거</span>
                    {detail.offer.excerpt}
                  </blockquote>
                )}
                <p className="offer-block-detail">
                  최종합격을 통보한 뒤의 취소는 심사 결과를 바꾸는 일이 아니라 이미 성립한 근로계약을
                  끊는 일이고, 해고로 다뤄집니다(근로기준법 제23조 제1항 — 정당한 이유 없이 해고하지
                  못한다). 그래도 진행해야 한다면 면접방에서 채용내정 취소 절차를 밟아야 합니다.
                </p>
                {detail.roomId && (
                  <Link
                    to={`/rooms/${detail.roomId}`}
                    onClick={() => markRoomDoor(detail.roomId, 'account')}
                  >
                    연결된 면접방으로 이동 →
                  </Link>
                )}
              </div>
            )}

            {detail.status === 'submitted' && (
              <div className="modal-actions">
                {canPass ? (
                  <button type="button" className="btn-primary" onClick={handlePass} disabled={working}>
                    서류합격 (계정·면접방 생성)
                  </button>
                ) : (
                  <p className="notice">서류합격(계정·면접방 생성)은 회사 계정에서만 가능합니다.</p>
                )}
                {/* 버튼을 없애지 않고 그 자리에서 막는다.
                    사라지면 담당자는 왜 없는지 모른 채 찾다가 다른 길을 찾는다.
                    같은 자리에 그대로 두되, 무엇 때문에 못 누르는지를 버튼이
                    직접 말하게 한다. */}
                <button
                  type="button"
                  className="btn-danger"
                  onClick={handleReject}
                  disabled={working || !!detail.offer?.established}
                  title={
                    detail.offer?.established
                      ? '채용내정이 성립해 탈락 처리할 수 없습니다. 취소는 해고 절차를 밟아야 합니다.'
                      : undefined
                  }
                >
                  {detail.offer?.established ? '채용내정 완료 — 탈락 불가' : '불합격'}
                </button>
              </div>
            )}
            {detail.status === 'passed' && detail.roomId && !passResult && (
              <div className="invite-code-block">
                {/* 입장 코드는 다시 확인할 수 있지만, 이메일 재발송 여부는
                    위의 저장된 결과 상태로만 판단한다. */}
                <p>
                  면접방 입장 코드: <code>{detail.inviteCode || '-'}</code>{' '}
                  {detail.inviteCode && (
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={() => navigator.clipboard?.writeText(detail.inviteCode)}
                    >
                      복사
                    </button>
                  )}
                </p>
                <div className="modal-actions">
                  <Link
                    to={`/rooms/${detail.roomId}`}
                    className="btn-nav"
                    onClick={() => markRoomDoor(detail.roomId, 'account')}
                  >
                    연결된 면접방으로 이동 →
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </>
    </Modal>
  )
}

export default function RecruitPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [postings, setPostings] = useState([])
  const [applications, setApplications] = useState([])
  const [postingsLoading, setPostingsLoading] = useState(true)
  const [applicationsLoading, setApplicationsLoading] = useState(true)
  const [postingsError, setPostingsError] = useState('')
  const [applicationsError, setApplicationsError] = useState('')
  const readGeneration = useRef({ postings: 0, applications: 0 })
  const [selectedApp, setSelectedApp] = useState(null)
  const [comparePosting, setComparePosting] = useState(null)
  const [qrPosting, setQrPosting] = useState(null)

  // 새 공고 폼
  const [form, setForm] = useState(EMPTY_POSTING)

  const [creating, setCreating] = useState(false)
  const createRequest = useCreateRequest('/postings')
  const [drafts, setDrafts] = useState([])
  const [draftId, setDraftId] = useState(null)
  const [draftRevision, setDraftRevision] = useState(0)
  const [draftSavedAt, setDraftSavedAt] = useState(null)
  const [savedForm, setSavedForm] = useState(JSON.stringify(EMPTY_POSTING))
  const [savingDraft, setSavingDraft] = useState(false)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [draftsLoading, setDraftsLoading] = useState(true)
  const [draftsError, setDraftsError] = useState('')
  const draftBusy = creating || savingDraft || loadingDraft || createRequest.unconfirmed
  const unsaved = JSON.stringify(form) !== savedForm

  const loadDrafts = useCallback(async () => {
    setDraftsLoading(true)
    setDraftsError('')
    try { setDrafts((await api.get('/posting-drafts')).drafts) }
    catch (err) { setDraftsError(err.message) }
    finally { setDraftsLoading(false) }
  }, [])

  useEffect(() => { loadDrafts() }, [loadDrafts])

  const resetDraftForm = () => {
    setForm(EMPTY_POSTING)
    setDraftId(null)
    setDraftRevision(0)
    setDraftSavedAt(null)
    setSavedForm(JSON.stringify(EMPTY_POSTING))
  }

  const saveDraft = async () => {
    if (draftBusy) return
    const id = draftId || crypto.randomUUID()
    setDraftId(id) // Retain the id after network errors for an idempotent retry.
    setSavingDraft(true)
    try {
      const saved = await api.put(`/posting-drafts/${id}`, { fields: form, revision: draftRevision })
      setDraftRevision(saved.revision)
      setDraftSavedAt(saved.updatedAt)
      setSavedForm(JSON.stringify(form))
      toast.success('임시저장했습니다. 공고는 아직 공개되지 않습니다.')
      await loadDrafts()
    } catch (err) { toast.error(err.message) }
    finally { setSavingDraft(false) }
  }

  const openDraft = async (id) => {
    if (draftBusy || (unsaved && !window.confirm('저장하지 않은 변경사항이 있습니다. 임시저장 공고를 불러오시겠습니까?'))) return
    setLoadingDraft(true)
    try {
      const { draft } = await api.get(`/posting-drafts/${id}`)
      const fields = { ...EMPTY_POSTING, ...draft.fields }
      setForm(fields)
      setDraftId(draft.id)
      setDraftRevision(draft.revision)
      setDraftSavedAt(draft.updatedAt)
      setSavedForm(JSON.stringify(fields))
      toast.success('임시저장 공고를 불러왔습니다.')
    } catch (err) { toast.error(err.message) }
    finally { setLoadingDraft(false) }
  }

  const reusePosting = async (posting) => {
    if (draftBusy || (unsaved && !window.confirm('작성 중인 내용 대신 이전 공고를 불러오시겠습니까? 저장하지 않은 내용은 사라집니다.'))) return
    setLoadingDraft(true)
    try {
      const { fields } = await api.get(`/postings/${posting.id}/reuse`)
      resetDraftForm()
      setForm({ ...EMPTY_POSTING, ...fields })
      toast.success('새 공고로 불러왔습니다. 마감일과 본문의 날짜·급여·근무 조건을 확인해주세요. 아직 공개되지 않았습니다.')
      document.getElementById('new-posting-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      document.querySelector('#new-posting-form input')?.focus({ preventScroll: true })
    } catch (err) { toast.error(err.message) }
    finally { setLoadingDraft(false) }
  }

  // 지원서 검색·필터
  const [appSearch, setAppSearch] = useState('')
  const [appStatus, setAppStatus] = useState('all')
  const filteredApps = useMemo(() => {
    const q = appSearch.trim().toLowerCase()
    return applications.filter((a) => {
      if (appStatus !== 'all' && a.status !== appStatus) return false
      if (!q) return true
      return (
        a.applicantName?.toLowerCase().includes(q) ||
        a.applicantEmail?.toLowerCase().includes(q) ||
        a.postingTitle?.toLowerCase().includes(q)
      )
    })
  }, [applications, appSearch, appStatus])

  const [appsTruncated, setAppsTruncated] = useState(null)

  const loadPostings = useCallback(async () => {
    const generation = ++readGeneration.current.postings
    setPostingsLoading(true)
    setPostingsError('')
    try {
      const data = await api.get('/postings')
      if (generation === readGeneration.current.postings) setPostings(data.postings)
    } catch (err) {
      if (generation === readGeneration.current.postings) setPostingsError(err.message || '공고 목록을 불러오지 못했습니다.')
    } finally {
      if (generation === readGeneration.current.postings) setPostingsLoading(false)
    }
  }, [])

  const loadApplications = useCallback(async () => {
    const generation = ++readGeneration.current.applications
    setApplicationsLoading(true)
    setApplicationsError('')
    try {
      const data = await api.get('/applications')
      if (generation !== readGeneration.current.applications) return
      setApplications(data.applications)
      // 검색·통계는 받아 온 범위 안에서만 계산한다.
      setAppsTruncated(data.truncated ? data.limit : null)
    } catch (err) {
      if (generation === readGeneration.current.applications) setApplicationsError(err.message || '지원서 목록을 불러오지 못했습니다.')
    } finally {
      if (generation === readGeneration.current.applications) setApplicationsLoading(false)
    }
  }, [])

  // Each resource owns its failure state: a failed application lookup must not
  // hide successfully loaded postings or turn a completed write into a failure.
  const loadAll = useCallback(() => Promise.all([loadPostings(), loadApplications()]), [loadPostings, loadApplications])

  useEffect(() => {
    void loadAll()
    const generations = readGeneration.current
    return () => { generations.postings += 1; generations.applications += 1 }
  }, [loadAll])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (creating || savingDraft || loadingDraft || createRequest.inFlight()) return
    setCreating(true)
    try {
      const result = await createRequest.run({ ...form, ...(draftId ? { draftId, draftRevision } : {}) })
      if (!result) return
      // 한 곳에 모아 둔 초기값을 그대로 쓴다. 예전에는 여기서 필드를 빠뜨려
      // 그 칸이 제어를 벗어났고, 화면에는 앞 공고의 값이 남아 있는데 다음 공고는
      // 비어 있는 채로 저장됐다.
      resetDraftForm()
      toast.success('공고가 정상 등록되었습니다.')
      await loadDrafts()
      await loadAll()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCreating(false)
    }
  }

  const toggleStatus = async (posting) => {
    const next = posting.status === 'open' ? 'closed' : 'open'
    try {
      await api.patch(`/postings/${posting.id}`, { status: next })
      toast.success(next === 'closed' ? '공고를 마감했습니다.' : '공고를 다시 모집합니다.')
      await loadAll()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const deletePosting = async (posting) => {
    if (!window.confirm(`'${posting.title}' 공고를 삭제하시겠습니까?`)) return
    try {
      await api.delete(`/postings/${posting.id}`)
      toast.success('공고가 삭제되었습니다.')
      await loadAll()
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div className="recruit-page">
      <UnsavedChangesGuard when={unsaved || draftBusy} message={createRequest.unconfirmed
        ? '공고 등록 결과가 아직 확인되지 않았습니다. 이 화면에서 같은 요청으로 다시 시도해 결과를 확인해주세요. 지금 이동하면 재시도 정보가 사라집니다.'
        : '작성 중인 공고가 있습니다. 내용을 보관하려면 먼저 임시저장해주세요. 저장하지 않고 이동하면 변경사항이 사라집니다.'} />
      <header className="dashboard-header">
        <h1>채용 관리</h1>
        <div className="header-actions">
          <NotificationBell />
          <Link to="/dashboard" className="btn-nav">
            대시보드
          </Link>
        </div>
      </header>

      <section className="recruit-section">
        <h2>채용 공고 등록</h2>
        <p className="muted" role="status">
          {draftSavedAt ? `${formatKst(draftSavedAt)} 임시저장${unsaved ? ' · 저장하지 않은 변경사항' : ''}` : '임시저장한 공고는 본인에게만 보입니다.'}
        </p>
        {createRequest.unconfirmed && (
          <div className="notice" role="alert">
            <p>공고 등록 결과를 확인하지 못했습니다. 입력은 보존했으며, 중복 등록을 막기 위해 같은 요청으로 다시 시도합니다. 이 화면을 닫거나 새로고침하기 전에 결과를 확인해주세요.</p>
            <button type="button" className="btn-secondary" disabled={creating} onClick={handleCreate}>
              {creating ? '등록 확인 중...' : '같은 요청으로 등록 다시 시도'}
            </button>
          </div>
        )}
        <form id="new-posting-form" onSubmit={handleCreate} className="posting-form">
          <fieldset className="posting-draft-fields" disabled={draftBusy}>
          <label>
            공고 제목 <span className="consent-required" aria-hidden="true">*</span>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </label>
          <div className="career-row">
            <label>
              부서/조직
              <input
                value={form.department}
                onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
              />
            </label>
            <label>
              고용형태
              <input
                value={form.employmentType}
                onChange={(e) => setForm((f) => ({ ...f, employmentType: e.target.value }))}
                placeholder="정규직 / 인턴 등"
              />
            </label>
            <label>
              근무지
              <input
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              />
            </label>
            <label>
              마감일 (선택)
              <input
                type="date"
                value={form.deadline}
                onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
              />
            </label>
          </div>

          {/* 공고에 제시한 조건은 나중에 계약서와 대조된다. 값으로 남겨 두면
              지원자가 무엇을 전제로 지원했는지 확인할 수 있다
              (채용절차법 제4조 제3항 — 제시한 조건을 불리하게 바꾸는 것을 금지). */}
          <fieldset className="posting-conditions">
            <legend>제시 근로조건 (선택 — 적으면 계약서와 자동으로 대조합니다)</legend>
            <div className="form-grid">
              <label>
                임금 종류
                <select
                  value={form.wageType}
                  onChange={(e) => setForm((f) => ({ ...f, wageType: e.target.value }))}
                >
                  <option value="">선택 안 함</option>
                  <option value="monthly">월급</option>
                  <option value="hourly">시급</option>
                  <option value="annual">연봉</option>
                </select>
              </label>
              <label>
                최소 금액
                <input
                  value={form.wageMin}
                  onChange={(e) => setForm((f) => ({ ...f, wageMin: e.target.value }))}
                  placeholder="2500000"
                  inputMode="numeric"
                />
              </label>
              <label>
                최대 금액 (선택)
                <input
                  value={form.wageMax}
                  onChange={(e) => setForm((f) => ({ ...f, wageMax: e.target.value }))}
                  placeholder="3000000"
                  inputMode="numeric"
                />
              </label>
              <label>
                근무 시작
                <input
                  value={form.workHoursStart}
                  onChange={(e) => setForm((f) => ({ ...f, workHoursStart: e.target.value }))}
                  placeholder="09:00"
                />
              </label>
              <label>
                근무 종료
                <input
                  value={form.workHoursEnd}
                  onChange={(e) => setForm((f) => ({ ...f, workHoursEnd: e.target.value }))}
                  placeholder="18:00"
                />
              </label>
              <label>
                근무일
                <input
                  value={form.workDays}
                  onChange={(e) => setForm((f) => ({ ...f, workDays: e.target.value }))}
                  placeholder="주 5일 (월~금)"
                />
              </label>
            </div>
          </fieldset>

          <PostingEditor value={form.description}
            onChange={(description) => setForm((f) => ({ ...f, description }))}
            onLoadExample={() => {
              if ((form.title || form.description) && !window.confirm('작성 중인 공고를 예시 공고문으로 바꾸시겠습니까?')) return
              setForm({ ...EMPTY_POSTING, ...EXAMPLE_POSTING })
            }} />
          <div className="posting-editor-toolbar">
          <button type="button" className="btn-secondary" onClick={saveDraft}>
            {savingDraft ? '저장 중...' : '임시저장'}
          </button>
          <button type="submit" className="btn-primary">
            {creating ? '등록 중...' : '공고 등록'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => {
            if (unsaved && !window.confirm('저장하지 않은 변경사항이 있습니다. 새 공고를 작성하시겠습니까?')) return
            resetDraftForm()
          }}>새 공고 작성</button>
          </div>
          </fieldset>
        </form>
      </section>

      <section className="recruit-section" aria-labelledby="posting-drafts-title">
        <div className="dashboard-header">
          <h2 id="posting-drafts-title">내 임시저장 공고</h2>
          <button type="button" className="btn-sm" onClick={loadDrafts} disabled={draftsLoading || draftBusy}>새로고침</button>
        </div>
        {draftsLoading ? <p role="status">불러오는 중...</p> : draftsError ? <p role="alert" className="error">{draftsError}</p> : drafts.length === 0 ?
          <p className="notice">임시저장한 공고가 없습니다.</p> :
          <ul className="posting-management-list" aria-label={`내 임시저장 공고 ${drafts.length}건`}>
            {drafts.map(draft => <li key={draft.id}>
              <div className="posting-management-heading">
                <h3>{draft.title || '제목 없는 공고'}</h3>
                {draft.id === draftId && <span className="badge badge-neutral">작성 중</span>}
              </div>
              <dl className="posting-management-meta"><div><dt>저장 시각</dt><dd>{formatKst(draft.updatedAt)}</dd></div></dl>
              <div className="posting-management-actions">
                <button type="button" className="btn-sm" onClick={() => openDraft(draft.id)} disabled={draftBusy}
                  aria-label={`${draft.title || '제목 없는 공고'} 불러오기`}>불러오기</button>
              </div>
            </li>)}
          </ul>}
      </section>

      <section className="recruit-section">
        <h2>내 채용 공고</h2>
        {postingsLoading ? (
          <p role="status">불러오는 중...</p>
        ) : postingsError ? (
          <div>
            <p className="error" role="alert">공고 목록을 불러오지 못했습니다. 저장·처리 결과와는 별개로 목록을 다시 확인해주세요. {postingsError}</p>
            <button type="button" className="btn-secondary" onClick={loadPostings}>공고 다시 불러오기</button>
          </div>
        ) : postings.length === 0 ? (
          <p className="notice">등록된 공고가 없습니다.</p>
        ) : (
          <ul className="posting-management-list" aria-label={`내가 등록한 채용 공고 ${postings.length}건`}>
                {postings.map((p) => (
                  <li key={p.id}>
                    <div className="posting-management-heading">
                      <h3><Link to={`/jobs/${p.id}`}>{p.title}</Link></h3>
                      <span className={`badge ${p.status === 'open' ? 'badge-success' : 'badge-neutral'}`}>
                        {p.status === 'open' ? '모집 중' : '마감'}
                      </span>
                    </div>
                    <dl className="posting-management-meta">
                      <div><dt>마감일</dt><dd>{p.deadline || '상시'}</dd></div>
                      <div><dt>지원자</dt><dd>{p.applicationCount}명</dd></div>
                      <div><dt>등록일</dt><dd>{formatKstDate(p.createdAt)}</dd></div>
                    </dl>
                    <div className="posting-management-actions" role="group" aria-label={`${p.title} 관리`}>
                      {p.canReuse && <><button type="button" className="btn-sm" disabled={draftBusy} onClick={() => reusePosting(p)}>복사해 새 공고 작성</button>{' '}</>}
                      <button type="button" className="btn-sm" disabled={p.status !== 'open' || Boolean(p.deadline && p.deadline < formatKstDate(new Date().toISOString()))} onClick={() => setQrPosting(p)}>QR 코드 만들기</button>{' '}
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => setComparePosting({ id: p.id, title: p.title })}
                        disabled={p.applicationCount === 0}
                      >
                        지원자 비교
                      </button>{' '}
                      <button type="button" className="btn-sm" onClick={() => toggleStatus(p)}>
                        {p.status === 'open' ? '마감하기' : '다시 모집'}
                      </button>{' '}
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        onClick={() => deletePosting(p)}
                      >
                        삭제
                      </button>
                    </div>
                  </li>
                ))}
          </ul>
        )}
      </section>

      {qrPosting && <PostingQrModal posting={qrPosting} onClose={() => setQrPosting(null)} />}
      {comparePosting && (
        <ApplicantCompare
          postingId={comparePosting.id}
          postingTitle={comparePosting.title}
          onClose={() => setComparePosting(null)}
          onOpenApplication={setSelectedApp}
        />
      )}

      <section className="recruit-section">
        <h2>지원서</h2>
        {applicationsLoading ? (
          <p role="status">불러오는 중...</p>
        ) : applicationsError ? (
          <div>
            <p className="error" role="alert">지원서 목록을 불러오지 못했습니다. {applicationsError}</p>
            <button type="button" className="btn-secondary" onClick={loadApplications}>지원서 목록 다시 불러오기</button>
          </div>
        ) : applications.length === 0 ? (
          <p className="notice">아직 접수된 지원서가 없습니다.</p>
        ) : (
          <>
            {appsTruncated && (
              <p className="notice">
                지원서가 많아 최근 {appsTruncated}건만 불러왔습니다. 아래 검색·통계도 이 범위
                안에서만 계산됩니다.
              </p>
            )}
            <div className="filter-row">
              <input
                type="search"
                placeholder="이름·이메일·공고 검색"
                aria-label="지원자 검색 (이름·이메일·공고)"
                value={appSearch}
                onChange={(e) => setAppSearch(e.target.value)}
              />
              <select
                value={appStatus}
                aria-label="지원 상태로 거르기"
                onChange={(e) => setAppStatus(e.target.value)}
              >
                <option value="all">전체 상태</option>
                <option value="submitted">심사 대기</option>
                <option value="passed">서류합격</option>
                <option value="rejected">불합격</option>
                <option value="withdrawn">지원 철회</option>
              </select>
              <span className="filter-count">{filteredApps.length}건</span>
            </div>
            {filteredApps.length === 0 ? (
              <p className="notice">조건에 맞는 지원서가 없습니다.</p>
            ) : (
              <div className="table-scroll" tabIndex={0}>
                <table className="admin-table">
                  <caption className="sr-only">
                    조건에 맞는 지원서 {filteredApps.length}건
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">이름</th>
                      <th scope="col">공고</th>
                      <th scope="col">이메일</th>
                      <th scope="col">상태</th>
                      <th scope="col">지원일</th>
                      <th scope="col">
                        <span className="sr-only">지원서 상세</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApps.map((a) => (
                  <tr key={a.id}>
                    <th scope="row" className="cell-rowhead">
                      {a.applicantName}
                    </th>
                    <td>{a.postingTitle}</td>
                    <td>{a.applicantEmail}</td>
                    <td>
                      <span className={`badge ${STATUS_LABEL[a.status]?.badge || 'badge-neutral'}`}>
                        {STATUS_LABEL[a.status]?.label || a.status}
                      </span>
                    </td>
                    <td>{formatKstDate(a.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => setSelectedApp(a.id)}
                        aria-label={`${a.applicantName} 지원서 상세`}
                      >
                        상세
                      </button>
                    </td>
                  </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {selectedApp && (
        <ApplicationDetail
          key={selectedApp}
          appId={selectedApp}
          onClose={() => setSelectedApp(null)}
          onChanged={loadAll}
          canPass={user.role === 'company'}
        />
      )}
    </div>
  )
}


