import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { CONSENT_ITEMS, CONSENT_VERSION } from '../lib/consentText.js'
import { isApplyFormDirty, LEAVE_CONFIRM_MESSAGE } from '../lib/applyForm.js'
import UnsavedChangesGuard from '../components/UnsavedChangesGuard.jsx'
import { applicationOperation, restartApplicationOperation } from '../lib/applicationSelfService.js'

const EMPLOYMENT_TYPES = ['정규직', '계약직', '인턴', '아르바이트', '프리랜서', '기타']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

function emptyCareer(key) {
  return {
    _key: key,
    employmentType: '',
    companyName: '',
    startDate: '',
    endDate: '',
    current: false,
    department: '',
    position: '',
    description: '',
  }
}

function ConsentItem({ item, checked, onToggle }) {
  const [open, setOpen] = useState(false)
  const bodyId = `consent-text-${item.key}`
  return (
    <div className="consent-item">
      {/* 전문 보기 버튼이 label 안에 있으면 그 글자까지 동의 항목의 이름으로 읽혀
          "…동의 (필수) 전문 보기 체크박스"가 된다. 무엇에 동의하는지가 흐려지므로
          버튼을 label 밖으로 뺐다. */}
      <div className="consent-head">
        {/* 체크할 칸을 (필수)·(선택) 표시 바로 옆에 둔다. 무엇에 동의하는지
            읽고 나서 그 자리에서 누르게 된다. */}
        <label className="consent-label">
          <span>
            {item.label}{' '}
            <span className={item.required ? 'consent-required' : 'consent-optional'}>
              ({item.required ? '필수' : '선택'})
            </span>
          </span>
          <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
        </label>
        <button
          type="button"
          className="consent-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '접기' : '전문 보기'}
        </button>
      </div>
      {open && (
        <pre className="consent-text" id={bodyId}>
          {item.text}
        </pre>
      )}
    </div>
  )
}

export default function ApplyPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [posting, setPosting] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [postingLoading, setPostingLoading] = useState(true)
  const [reload, setReload] = useState(0)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [careers, setCareers] = useState([])
  const [resume, setResume] = useState(null)
  const [portfolio, setPortfolio] = useState(null)

  const [consents, setConsents] = useState({
    consentRequired: false,
    consentOptional: false,
    consentThirdParty: false,
  })

  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [lookupCode, setLookupCode] = useState('')
  const [receiptStatus, setReceiptStatus] = useState('submitted')
  const careerKeyRef = useRef(0)
  const submitRef = useRef(false)

  const pickFile = (setter) => (event) => {
    const file = event.target.files?.[0] || null
    if (file && file.size > MAX_FILE_SIZE) {
      toast.error('파일 크기는 10MB 이하만 첨부할 수 있습니다.')
      event.target.value = ''
      setter(null)
      return
    }
    setter(file)
  }

  useEffect(() => {
    let active = true
    setPostingLoading(true)
    setLoadError('')
    api
      .get(`/jobs/${id}`)
      .then((data) => { if (active) setPosting(data.posting) })
      .catch((err) => { if (active) setLoadError(err.message || '공고를 확인하지 못했습니다.') })
      .finally(() => { if (active) setPostingLoading(false) })
    return () => { active = false }
  }, [id, reload])

  useEffect(() => {
    let active = true
    try {
      const operationToken = sessionStorage.getItem(`portfolioApplicationOperation:${id}`)
      if (operationToken) void api.post('/application-receipt', { postingId: id, operationToken })
        .then(result => { if (active) { setLookupCode(result.lookupCode); setReceiptStatus(result.status || 'submitted'); setDone(true) } })
        .catch(() => {})
    } catch { /* Receipt recovery remains available through email verification. */ }
    return () => { active = false }
  }, [id])

  // 로그인 없이 지원하는 구조라 쓰다 만 지원서는 어디에도 남지 않는다.
  // 실수로 탭을 닫거나 새로고침하면 전부 사라지므로 한 번 되묻는다.
  const dirty = isApplyFormDirty({ name, email, phone, careers, resume, portfolio })

  const allChecked = useMemo(
    () => CONSENT_ITEMS.every((c) => consents[c.key]),
    [consents]
  )

  const toggleAll = (value) => {
    const next = {}
    for (const c of CONSENT_ITEMS) next[c.key] = value
    setConsents(next)
  }

  const updateCareer = (index, field, value) => {
    setCareers((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitRef.current) return
    if (postingLoading || loadError || !posting || posting.open === false) {
      toast.error('모집 중인 공고인지 먼저 확인해주세요.')
      return
    }

    if (!consents.consentRequired) {
      toast.error('개인정보 필수항목 수집·이용에 동의해야 지원할 수 있습니다.')
      return
    }
    if (!resume) {
      toast.error('이력서 파일을 첨부해주세요.')
      return
    }
    if (!consents.consentOptional && (careers.length || portfolio)) {
      toast.error('경력사항과 포트폴리오를 제거하거나 선택항목 수집에 동의해주세요.')
      return
    }

    submitRef.current = true
    setSubmitting(true)
    try {
      const form = new FormData()
      form.append('operationToken', applicationOperation(id))
      form.append('consentVersion', CONSENT_VERSION)
      form.append('applicantName', name)
      form.append('applicantEmail', email)
      form.append('applicantPhone', phone)
      form.append('careerJson', JSON.stringify(careers))
      form.append('consentRequired', consents.consentRequired ? 'true' : 'false')
      form.append('consentOptional', consents.consentOptional ? 'true' : 'false')
      form.append('resume', resume)
      if (portfolio) form.append('portfolio', portfolio)

      const res = await api.upload(`/jobs/${id}/apply`, form)
      setLookupCode(res.lookupCode || '')
      setReceiptStatus(res.status || 'submitted')
      setDone(true)
      if (res.recovered) toast.success('기존 접수 내역을 확인했습니다.')
      else toast.success('지원서가 정상 제출되었습니다.')
    } catch (err) {
      // A response lost after database commit must recover the original receipt.
      try {
        const result = await api.post('/application-receipt', { postingId: id, operationToken: applicationOperation(id) })
        setLookupCode(result.lookupCode); setReceiptStatus(result.status || 'submitted'); setDone(true)
        toast.success('접수된 지원 내역을 확인했습니다.')
      } catch { toast.error(`${err.message} 접수 여부가 불확실하면 다시 제출하거나 이메일로 지원 내역을 확인해주세요.`) }
    } finally {
      submitRef.current = false
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="apply-page">
        <div className="apply-done">
          <h1>{receiptStatus === 'withdrawn' ? '철회한 지원 내역입니다' : receiptStatus === 'passed' ? '서류에 합격한 지원입니다' : receiptStatus === 'rejected' ? '불합격한 지원 내역입니다' : '지원이 완료되었습니다'}</h1>
          {receiptStatus === 'submitted' && <p>
            서류 심사 후 결과를 지원하신 이메일{email ? <>(<strong>{email}</strong>)</> : null}로
            안내드립니다.
          </p>}
          {['submitted', 'passed'].includes(receiptStatus) && <p className="notice">
            서류에 합격하면 결과 이메일의 입장 코드로 면접방에 들어갈 수 있습니다.
          </p>}
          {receiptStatus === 'withdrawn' && <><p>이전 지원은 철회되어 심사하지 않습니다. 새로 지원하려면 아래에서 새 지원서를 시작해주세요.</p>
            {posting?.status === 'open' && <button type="button" className="btn-primary" onClick={() => {
              try { restartApplicationOperation(id); setLookupCode(''); setReceiptStatus('submitted'); setDone(false) }
              catch { toast.error('새 지원 정보를 저장하지 못했습니다. 브라우저 저장소 설정을 확인해주세요.') }
            }}>새 지원서 작성</button>}</>}
          {lookupCode && (
            <div className="lookup-code-box">
              <p className="lookup-code-label">접수번호 (심사 상태 조회에 사용됩니다 — 꼭 보관하세요)</p>
              <p className="lookup-code">
                <code>{lookupCode}</code>
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() => navigator.clipboard?.writeText(lookupCode)}
                >
                  복사
                </button>
              </p>
              <Link to={`/application-status?code=${lookupCode}`}>지원 현황 바로 조회하기 →</Link>
            </div>
          )}
          <button type="button" className="btn-primary" onClick={() => navigate('/jobs')}>
            다른 공고 보기
          </button>
          <p><Link to="/application-manage">제출 내용 확인·수정 · 지원 철회</Link></p>
        </div>
      </div>
    )
  }

  return (
    <div className="apply-page">
      <UnsavedChangesGuard when={dirty || submitting} message={LEAVE_CONFIRM_MESSAGE} />
      <header className="page-header">
        <Link to={`/jobs/${id}`} className="back-link">
          ← 공고로 돌아가기
        </Link>
        <h1>{posting ? posting.title : '지원서 작성'}</h1>
        <p className="apply-required-note">
          <span className="consent-required" aria-hidden="true">*</span> 표시는 필수 입력 항목입니다.
        </p>
      </header>

      {postingLoading && <p role="status">지원할 공고를 확인하는 중입니다. 입력은 계속할 수 있습니다.</p>}
      {loadError && <div>
        <p className="error" role="alert">공고를 확인하지 못해 아직 제출할 수 없습니다. 작성 중인 내용은 유지됩니다. {loadError}</p>
        <button type="button" className="btn-secondary" onClick={() => setReload(value => value + 1)}>공고 다시 불러오기</button>
        <p><Link to="/jobs">← 채용 공고 목록으로</Link></p>
      </div>}
      {!postingLoading && !loadError && posting?.open === false && <p className="notice" role="status">마감된 공고에는 지원할 수 없습니다. 다른 공고를 확인해주세요.</p>}

      <form onSubmit={handleSubmit} className="apply-form">
        <section className="apply-section">
          <h2>기본정보</h2>
          <label>
            이름 <span className="consent-required" aria-hidden="true">*</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          </label>
          <label>
            이메일주소 <span className="consent-required" aria-hidden="true">*</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="합격 시 이 이메일이 로그인 아이디가 됩니다"
              required
            />
          </label>
          <label>
            연락처 <span className="consent-required" aria-hidden="true">*</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="010-0000-0000"
              maxLength={40}
              required
            />
          </label>
        </section>

        <section className="apply-section">
          <h2>경력사항</h2>
          {careers.length === 0 && <p className="notice">경력이 있으시면 항목을 추가해주세요. (선택)</p>}
          {careers.map((career, index) => (
            <div className="career-entry" key={career._key}>
              <div className="career-row">
                <label>
                  고용형태
                  <select
                    value={career.employmentType}
                    onChange={(e) => updateCareer(index, 'employmentType', e.target.value)}
                  >
                    <option value="">선택</option>
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  회사명
                  <input
                    value={career.companyName}
                    onChange={(e) => updateCareer(index, 'companyName', e.target.value)}
                  />
                </label>
              </div>
              <div className="career-row">
                <label>
                  입사일
                  <input
                    type="month"
                    value={career.startDate}
                    onChange={(e) => updateCareer(index, 'startDate', e.target.value)}
                  />
                </label>
                <label>
                  퇴사일
                  <input
                    type="month"
                    value={career.endDate}
                    onChange={(e) => updateCareer(index, 'endDate', e.target.value)}
                    disabled={career.current}
                  />
                </label>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={career.current}
                  onChange={(e) => updateCareer(index, 'current', e.target.checked)}
                />
                재직 중
              </label>
              <div className="career-row">
                <label>
                  부서
                  <input
                    value={career.department}
                    onChange={(e) => updateCareer(index, 'department', e.target.value)}
                  />
                </label>
                <label>
                  직급
                  <input
                    value={career.position}
                    onChange={(e) => updateCareer(index, 'position', e.target.value)}
                  />
                </label>
              </div>
              <label>
                담당업무
                <textarea
                  value={career.description}
                  onChange={(e) => updateCareer(index, 'description', e.target.value)}
                  rows={3}
                />
              </label>
              <button
                type="button"
                className="btn-danger btn-sm"
                onClick={() => setCareers((prev) => prev.filter((_, i) => i !== index))}
              >
                이 경력 삭제
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setCareers((prev) => [...prev, emptyCareer(careerKeyRef.current++)])}
          >
            + 항목 추가
          </button>
        </section>

        <section className="apply-section">
          <h2>제출서류</h2>
          <div className="file-field">
            <span className="file-field-label" id="resume-upload-help">
              이력서 / 경력기술서 <span className="consent-required" aria-hidden="true">*</span>{' '}
              <em>PDF, DOC, DOCX, HWP · 10MB 이하</em>
            </span>
            <label className="upload-button" htmlFor="resume-upload">
              {resume ? resume.name : '파일 업로드'}
              <input
                id="resume-upload"
                type="file"
                className="sr-only"
                accept=".pdf,.doc,.docx,.hwp,.hwpx"
                aria-describedby="resume-upload-help"
                onChange={pickFile(setResume)}
              />
            </label>
          </div>
          <div className="file-field">
            <span className="file-field-label" id="portfolio-upload-help">
              포트폴리오 <em>선택 · PDF, DOC, DOCX, HWP · 10MB 이하</em>
            </span>
            <label className="upload-button" htmlFor="portfolio-upload">
              {portfolio ? portfolio.name : '파일 업로드'}
              <input
                id="portfolio-upload"
                type="file"
                className="sr-only"
                accept=".pdf,.doc,.docx,.hwp,.hwpx"
                aria-describedby="portfolio-upload-help"
                onChange={pickFile(setPortfolio)}
              />
            </label>
          </div>
        </section>

        <section className="apply-section">
          <h2>개인정보 수집 및 이용 동의</h2>
          {CONSENT_ITEMS.map((item) => (
            <ConsentItem
              key={item.key}
              item={item}
              checked={consents[item.key]}
              onToggle={(value) => setConsents((prev) => ({ ...prev, [item.key]: value }))}
            />
          ))}
          {/* 전체 동의는 항목을 다 읽은 뒤에 누르는 것이다. 맨 위에 두면
              무엇에 동의하는지 보기 전에 먼저 누르게 된다. */}
          <label className="consent-all">
            <span>전체 동의</span>
            <input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} />
          </label>
        </section>

        <button type="submit" className="btn-primary btn-block" disabled={submitting || postingLoading || !!loadError || !posting || posting.open === false}>
          {submitting ? '제출 중...' : '지원서 제출하기'}
        </button>
      </form>
    </div>
  )
}
