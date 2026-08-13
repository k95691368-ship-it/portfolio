import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatKstDate } from '../lib/formatTime.js'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import NotificationBell from '../components/NotificationBell.jsx'
import ApplicantCompare from '../components/ApplicantCompare.jsx'
import Modal from '../components/Modal.jsx'

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
}

const FIT_LABEL = {
  high: { label: '적합도 높음', badge: 'badge-success' },
  medium: { label: '적합도 보통', badge: 'badge-warning' },
  low: { label: '적합도 낮음', badge: 'badge-danger' },
  unknown: { label: '판단 보류', badge: 'badge-neutral' },
}

function ApplicationDetail({ appId, onClose, onChanged, canPass }) {
  const toast = useToast()
  const [detail, setDetail] = useState(null)
  const [working, setWorking] = useState(false)
  const [passResult, setPassResult] = useState(null)
  const [screening, setScreening] = useState(null)
  const [screeningLoading, setScreeningLoading] = useState(false)

  const load = useCallback(() => {
    api
      .get(`/applications/${appId}`)
      .then((data) => {
        setDetail(data.application)
        setScreening(data.application.aiScreening)
      })
      .catch((err) => toast.error(err.message))
  }, [appId, toast])

  const handleScreen = async () => {
    setScreeningLoading(true)
    try {
      const data = await api.post(`/applications/${appId}/screen`, {})
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

  const handlePass = async () => {
    if (!window.confirm('서류합격 처리하시겠습니까? 지원자 계정과 면접방이 자동 생성됩니다.')) return
    setWorking(true)
    try {
      const result = await api.post(`/applications/${appId}/pass`, {})
      setPassResult(result)
      // 결과 통보 이메일이 실패해도 '처리되었습니다'만 뜨고 있었다. 채용절차법
      // 제10조는 구직자에게 채용 여부를 알리도록 한다. 알림이 실패한 것을
      // 알리지 않으면 담당자는 통보가 끝났다고 믿고 넘어간다.
      toast.success(
        result?.emailStatus === 'failed'
          ? '서류합격 처리되었습니다. 다만 결과 안내 이메일 발송에 실패했습니다 — 지원자에게 따로 연락해주세요.'
          : '서류합격 처리되었습니다. 지원자 계정과 면접방이 생성되었습니다.'
      )
      load()
      onChanged()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setWorking(false)
    }
  }

  // 입장 코드를 지원자에게 보낸다.
  //
  // 서류합격 처리 때 한 번 자동으로 나가지만 그것뿐이었다. 메일이 막혀 있거나
  // 지원자가 못 받았으면 다시 보낼 방법이 없었고, 코드가 전해지지 않으면
  // 지원자는 면접방에 들어올 수 없다.
  const handleSendCode = async () => {
    setWorking(true)
    try {
      const result = await api.post(`/applications/${appId}/send-code`, {})
      toast.success(`${result.sentTo} 로 면접방 입장 코드를 보냈습니다.`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setWorking(false)
    }
  }

  const handleReject = async () => {
    if (!window.confirm('불합격 처리하시겠습니까?')) return
    setWorking(true)
    try {
      const result = await api.post(`/applications/${appId}/reject`, {})
      toast.success(
        result?.emailStatus === 'failed'
          ? '불합격 처리되었습니다. 다만 결과 안내 이메일 발송에 실패했습니다 — 지원자에게 따로 연락해주세요.'
          : '불합격 처리되었습니다.'
      )
      load()
      onChanged()
    } catch (err) {
      toast.error(err.message)
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
        {!detail ? (
          <p>불러오는 중...</p>
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
                  <em>
                    {passResult.emailStatus === 'sent'
                      ? '합격 안내 메일에 이 코드를 함께 보냈습니다. 지원자는 채용 공고 화면에서 코드를 넣어 로그인 없이 들어옵니다.'
                      : '메일이 나가지 않았습니다 — 이 코드를 지원자에게 직접 전달해주세요. 지원자는 채용 공고 화면에서 코드를 넣어 로그인 없이 들어옵니다.'}
                  </em>
                </p>
                {passResult.roomId && (
                  <p>
                    <Link to={`/rooms/${passResult.roomId}`}>생성된 면접방으로 이동 →</Link>
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
                      <a href={`/api/applications/${appId}/doc/${d.id}`}>
                        {d.docType === 'resume' ? '이력서' : '포트폴리오'}: {d.filename}
                      </a>
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
                <button type="button" className="btn-sm" onClick={handleScreen} disabled={screeningLoading}>
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
                  <Link to={`/rooms/${detail.roomId}`}>연결된 면접방으로 이동 →</Link>
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
                {/* 코드가 전해지지 않으면 지원자는 면접방에 들어올 수 없다.
                    언제든 다시 보고 다시 보낼 수 있어야 한다. */}
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
                  <button type="button" onClick={handleSendCode} disabled={working}>
                    {working ? '보내는 중...' : '1차 서류합격 안내 · 입장 코드 메일 보내기'}
                  </button>
                  <Link to={`/rooms/${detail.roomId}`} className="btn-nav">
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
  const [loading, setLoading] = useState(true)
  const [selectedApp, setSelectedApp] = useState(null)
  const [comparePosting, setComparePosting] = useState(null)

  // 새 공고 폼
  const [form, setForm] = useState(EMPTY_POSTING)

  const [creating, setCreating] = useState(false)

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

  const loadAll = useCallback(async () => {
    const [p, a] = await Promise.all([api.get('/postings'), api.get('/applications')])
    setPostings(p.postings)
    setApplications(a.applications)
    // 상한에 걸려 일부만 받았으면 화면에서도 그 사실을 밝힌다. 검색·통계가
    // 받아 온 범위 안에서만 계산되기 때문이다.
    setAppsTruncated(a.truncated ? a.limit : null)
  }, [])

  useEffect(() => {
    loadAll()
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [loadAll, toast])

  const handleCreate = async (e) => {
    e.preventDefault()
    setCreating(true)
    try {
      await api.post('/postings', form)
      // 한 곳에 모아 둔 초기값을 그대로 쓴다. 예전에는 여기서 필드를 빠뜨려
      // 그 칸이 제어를 벗어났고, 화면에는 앞 공고의 값이 남아 있는데 다음 공고는
      // 비어 있는 채로 저장됐다.
      setForm(EMPTY_POSTING)
      await loadAll()
      toast.success('공고가 정상 등록되었습니다.')
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
      await loadAll()
      toast.success(next === 'closed' ? '공고를 마감했습니다.' : '공고를 다시 모집합니다.')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const deletePosting = async (posting) => {
    if (!window.confirm(`'${posting.title}' 공고를 삭제하시겠습니까?`)) return
    try {
      await api.delete(`/postings/${posting.id}`)
      await loadAll()
      toast.success('공고가 삭제되었습니다.')
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div className="recruit-page">
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
        <form onSubmit={handleCreate} className="posting-form">
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

          <label>
            상세 내용 <span className="consent-required" aria-hidden="true">*</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={6}
              required
            />
          </label>
          <button type="submit" className="btn-primary" disabled={creating}>
            {creating ? '등록 중...' : '공고 등록'}
          </button>
        </form>
      </section>

      <section className="recruit-section">
        <h2>내 채용 공고</h2>
        {loading ? (
          <p>불러오는 중...</p>
        ) : postings.length === 0 ? (
          <p className="notice">등록된 공고가 없습니다.</p>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <caption className="sr-only">내가 등록한 채용 공고 {postings.length}건</caption>
              <thead>
                <tr>
                  <th scope="col">제목</th>
                  <th scope="col">상태</th>
                  <th scope="col">마감일</th>
                  <th scope="col">지원자</th>
                  <th scope="col">등록일</th>
                  <th scope="col">관리</th>
                </tr>
              </thead>
              <tbody>
                {postings.map((p) => (
                  <tr key={p.id}>
                    <th scope="row" className="cell-rowhead">
                      {/* 제목이 그냥 글자였다. 표에서 이름을 누르면 그것으로
                          가는 것은 설명이 필요 없는 동작인데, 여기서만 아무
                          일도 일어나지 않았다. 지원자에게 보이는 바로 그
                          화면으로 보낸다 — 공고와 계약 조건이 어긋났는지
                          따지는 판정의 기준이 이 화면의 내용이다. */}
                      <Link to={`/jobs/${p.id}`}>{p.title}</Link>
                    </th>
                    <td>
                      <span className={`badge ${p.status === 'open' ? 'badge-success' : 'badge-neutral'}`}>
                        {p.status === 'open' ? '모집 중' : '마감'}
                      </span>
                    </td>
                    <td>{p.deadline || '상시'}</td>
                    <td>{p.applicationCount}명</td>
                    <td>{formatKstDate(p.createdAt)}</td>
                    <td>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
        {loading ? (
          <p>불러오는 중...</p>
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
              </select>
              <span className="filter-count">{filteredApps.length}건</span>
            </div>
            {filteredApps.length === 0 ? (
              <p className="notice">조건에 맞는 지원서가 없습니다.</p>
            ) : (
              <div className="table-scroll">
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
          appId={selectedApp}
          onClose={() => setSelectedApp(null)}
          onChanged={loadAll}
          canPass={user.role === 'company'}
        />
      )}
    </div>
  )
}


