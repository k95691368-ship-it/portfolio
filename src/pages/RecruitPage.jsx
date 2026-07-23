import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'

const STATUS_LABEL = {
  submitted: { label: '심사 대기', badge: 'badge-warning' },
  passed: { label: '서류합격', badge: 'badge-success' },
  rejected: { label: '불합격', badge: 'badge-danger' },
}

function ApplicationDetail({ appId, onClose, onChanged, canPass }) {
  const toast = useToast()
  const [detail, setDetail] = useState(null)
  const [working, setWorking] = useState(false)
  const [passResult, setPassResult] = useState(null)

  const load = useCallback(() => {
    api
      .get(`/applications/${appId}`)
      .then((data) => setDetail(data.application))
      .catch((err) => toast.error(err.message))
  }, [appId, toast])

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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content application-modal" onClick={(e) => e.stopPropagation()}>
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
              <p>
                필수 {detail.consent.required ? '✅' : '❌'} · 선택{' '}
                {detail.consent.optional ? '✅' : '❌'} · 제3자 제공{' '}
                {detail.consent.thirdParty ? '✅' : '❌'}
              </p>
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
      </div>
    </div>
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

  const loadAll = useCallback(async () => {
    const [p, a] = await Promise.all([api.get('/postings'), api.get('/applications')])
    setPostings(p.postings)
    setApplications(a.applications)
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
          <Link to="/dashboard">대시보드</Link>
        </div>
      </header>

      {!loading && <RecruitStats postings={postings} applications={applications} />}

      <section className="recruit-section">
        <h2>채용 공고 등록</h2>
        <form onSubmit={handleCreate} className="posting-form">
          <label>
            공고 제목 <span className="consent-required">*</span>
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
            상세 내용 <span className="consent-required">*</span>
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
              <thead>
                <tr>
                  <th>제목</th>
                  <th>상태</th>
                  <th>마감일</th>
                  <th>지원자</th>
                  <th>등록일</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {postings.map((p) => (
                  <tr key={p.id}>
                    <td>{p.title}</td>
                    <td>
                      <span className={`badge ${p.status === 'open' ? 'badge-success' : 'badge-neutral'}`}>
                        {p.status === 'open' ? '모집 중' : '마감'}
                      </span>
                    </td>
                    <td>{p.deadline || '상시'}</td>
                    <td>{p.applicationCount}명</td>
                    <td>{p.createdAt?.slice(0, 10)}</td>
                    <td>
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

      <section className="recruit-section">
        <h2>지원서</h2>
        {loading ? (
          <p>불러오는 중...</p>
        ) : applications.length === 0 ? (
          <p className="notice">아직 접수된 지원서가 없습니다.</p>
        ) : (
          <>
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
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>공고</th>
                      <th>이메일</th>
                      <th>상태</th>
                      <th>지원일</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApps.map((a) => (
                  <tr key={a.id}>
                    <td>{a.applicantName}</td>
                    <td>{a.postingTitle}</td>
                    <td>{a.applicantEmail}</td>
                    <td>
                      <span className={`badge ${STATUS_LABEL[a.status]?.badge || 'badge-neutral'}`}>
                        {STATUS_LABEL[a.status]?.label || a.status}
                      </span>
                    </td>
                    <td>{a.createdAt?.slice(0, 10)}</td>
                    <td>
                      <button type="button" className="btn-sm" onClick={() => setSelectedApp(a.id)}>
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
