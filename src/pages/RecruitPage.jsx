import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import NotificationBell from '../components/NotificationBell.jsx'
import ApplicantCompare from '../components/ApplicantCompare.jsx'
import Modal from '../components/Modal.jsx'

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
      toast.success('서류합격 처리되었습니다. 지원자 계정과 면접방이 생성되었습니다.')
      load()
      onChanged()
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
      await api.post(`/applications/${appId}/reject`, {})
      toast.success('불합격 처리되었습니다.')
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
                {passResult.account.tempPassword ? (
                  <p>
                    임시 비밀번호: <code>{passResult.account.tempPassword}</code>{' '}
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={() => navigator.clipboard?.writeText(passResult.account.tempPassword)}
                    >
                      복사
                    </button>
                    <br />
                    <em>이 비밀번호는 다시 표시되지 않습니다. 지원자에게 안전하게 전달하세요.</em>
                  </p>
                ) : (
                  <p>이미 가입된 이메일이라 기존 계정으로 면접방에 연결했습니다.</p>
                )}
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

            {detail.status === 'submitted' && (
              <div className="modal-actions">
                {canPass ? (
                  <button type="button" className="btn-primary" onClick={handlePass} disabled={working}>
                    서류합격 (계정·면접방 생성)
                  </button>
                ) : (
                  <p className="notice">서류합격(계정·면접방 생성)은 회사 계정에서만 가능합니다.</p>
                )}
                <button type="button" className="btn-danger" onClick={handleReject} disabled={working}>
                  불합격
                </button>
              </div>
            )}
            {detail.status === 'passed' && detail.roomId && !passResult && (
              <p>
                <Link to={`/rooms/${detail.roomId}`}>연결된 면접방으로 이동 →</Link>
              </p>
            )}
          </>
        )}
      </>
    </Modal>
  )
}

function RecruitStats({ postings, applications }) {
  const stats = useMemo(() => {
    const openPostings = postings.filter((p) => p.status === 'open').length
    const submitted = applications.filter((a) => a.status === 'submitted').length
    const passed = applications.filter((a) => a.status === 'passed').length
    const rejected = applications.filter((a) => a.status === 'rejected').length
    const total = applications.length
    const decided = passed + rejected
    const passRate = decided > 0 ? Math.round((passed / decided) * 100) : null
    return { total, openPostings, submitted, passed, rejected, passRate, count: postings.length }
  }, [postings, applications])

  const seg = (n) => (stats.total > 0 ? `${(n / stats.total) * 100}%` : '0%')

  return (
    <section className="recruit-section">
      <h2>채용 현황</h2>
      <div className="stat-row">
        <div className="stat-tile">
          <span className="stat-value">{stats.count}</span>
          <span className="stat-label">전체 공고</span>
          <span className="stat-sub">모집 중 {stats.openPostings}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">전체 지원자</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{stats.submitted}</span>
          <span className="stat-label">심사 대기</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{stats.passed}</span>
          <span className="stat-label">서류합격</span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{stats.passRate === null ? '—' : `${stats.passRate}%`}</span>
          <span className="stat-label">서류 합격률</span>
          <span className="stat-sub">합격/(합격+불합격)</span>
        </div>
      </div>

      {stats.total > 0 && (
        <div className="status-breakdown">
          <div className="status-bar" role="img" aria-label={`심사 대기 ${stats.submitted}, 서류합격 ${stats.passed}, 불합격 ${stats.rejected}`}>
            {stats.submitted > 0 && <span className="status-seg-submitted" style={{ width: seg(stats.submitted) }} />}
            {stats.passed > 0 && <span className="status-seg-passed" style={{ width: seg(stats.passed) }} />}
            {stats.rejected > 0 && <span className="status-seg-rejected" style={{ width: seg(stats.rejected) }} />}
          </div>
          <div className="status-legend">
            <span className="status-legend-item">
              <span className="status-dot status-seg-submitted" /> 심사 대기 {stats.submitted}
            </span>
            <span className="status-legend-item">
              <span className="status-dot status-seg-passed" /> 서류합격 {stats.passed}
            </span>
            <span className="status-legend-item">
              <span className="status-dot status-seg-rejected" /> 불합격 {stats.rejected}
            </span>
          </div>
        </div>
      )}
    </section>
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
  const [form, setForm] = useState({
    title: '',
    department: '',
    employmentType: '',
    location: '',
    deadline: '',
    description: '',
  })
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
      setForm({ title: '', department: '', employmentType: '', location: '', description: '' })
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

      {!loading && <RecruitStats postings={postings} applications={applications} />}

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
                      {p.title}
                    </th>
                    <td>
                      <span className={`badge ${p.status === 'open' ? 'badge-success' : 'badge-neutral'}`}>
                        {p.status === 'open' ? '모집 중' : '마감'}
                      </span>
                    </td>
                    <td>{p.deadline || '상시'}</td>
                    <td>{p.applicationCount}명</td>
                    <td>{p.createdAt?.slice(0, 10)}</td>
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
                value={appSearch}
                onChange={(e) => setAppSearch(e.target.value)}
              />
              <select value={appStatus} onChange={(e) => setAppStatus(e.target.value)}>
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
                    <td>{a.createdAt?.slice(0, 10)}</td>
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
