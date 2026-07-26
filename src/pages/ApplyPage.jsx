import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { CONSENT_ITEMS } from '../lib/consentText.js'

const EMPLOYMENT_TYPES = ['정규직', '계약직', '인턴', '아르바이트', '프리랜서', '기타']
const SOURCES = ['채용 사이트', '회사 홈페이지', '지인 추천', '검색', 'SNS', '기타']
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
  return (
    <div className="consent-item">
      <label className="consent-head">
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
        <span>
          {item.label}{' '}
          <span className={item.required ? 'consent-required' : 'consent-optional'}>
            ({item.required ? '필수' : '선택'})
          </span>
        </span>
        <button type="button" className="consent-toggle" onClick={(e) => { e.preventDefault(); setOpen((v) => !v) }}>
          {open ? '접기' : '전문 보기'}
        </button>
      </label>
      {open && <pre className="consent-text">{item.text}</pre>}
    </div>
  )
}

export default function ApplyPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [posting, setPosting] = useState(null)
  const [loadError, setLoadError] = useState('')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [careers, setCareers] = useState([])
  const [source, setSource] = useState('')
  const [coverLetter, setCoverLetter] = useState('')
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
  const careerKeyRef = useRef(0)

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
    api
      .get(`/jobs/${id}`)
      .then((data) => setPosting(data.posting))
      .catch((err) => setLoadError(err.message))
  }, [id])

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

    if (!consents.consentRequired) {
      toast.error('개인정보 필수항목 수집·이용에 동의해야 지원할 수 있습니다.')
      return
    }
    if (!resume) {
      toast.error('이력서 파일을 첨부해주세요.')
      return
    }

    setSubmitting(true)
    try {
      const form = new FormData()
      form.append('applicantName', name)
      form.append('applicantEmail', email)
      form.append('applicantPhone', phone)
      form.append('applicationSource', source)
      form.append('coverLetter', coverLetter)
      form.append('careerJson', JSON.stringify(careers))
      form.append('consentRequired', consents.consentRequired ? 'true' : 'false')
      form.append('consentOptional', consents.consentOptional ? 'true' : 'false')
      form.append('consentThirdParty', consents.consentThirdParty ? 'true' : 'false')
      form.append('resume', resume)
      if (portfolio) form.append('portfolio', portfolio)

      const res = await api.upload(`/jobs/${id}/apply`, form)
      setLookupCode(res.lookupCode || '')
      setDone(true)
      toast.success('지원서가 정상 제출되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <div className="apply-page">
        <p className="error">{loadError}</p>
        <p>
          <Link to="/jobs">← 채용 공고 목록으로</Link>
        </p>
      </div>
    )
  }

  if (done) {
    return (
      <div className="apply-page">
        <div className="apply-done">
          <h1>지원이 완료되었습니다</h1>
          <p>
            소중한 지원 감사합니다. 서류 심사 후 결과를 지원하신 이메일(<strong>{email}</strong>)로
            안내드립니다.
          </p>
          <p className="notice">
            서류에 합격하면 이 이메일을 아이디로 하는 계정과 임시 비밀번호가 발급됩니다.
          </p>
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
        </div>
      </div>
    )
  }

  return (
    <div className="apply-page">
      <header className="page-header">
        <Link to={`/jobs/${id}`} className="back-link">
          ← 공고로 돌아가기
        </Link>
        <h1>{posting ? posting.title : '지원서 작성'}</h1>
        <p className="apply-required-note">
          <span className="consent-required">*</span> 표시는 필수 입력 항목입니다.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="apply-form">
        <section className="apply-section">
          <h2>기본정보</h2>
          <label>
            이름 <span className="consent-required">*</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          </label>
          <label>
            이메일주소 <span className="consent-required">*</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="합격 시 이 이메일이 로그인 아이디가 됩니다"
              required
            />
          </label>
          <label>
            연락처 <span className="consent-required">*</span>
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
            <span className="file-field-label">
              이력서 / 경력기술서 <span className="consent-required">*</span>{' '}
              <em>PDF, DOC, DOCX, HWP · 10MB 이하</em>
            </span>
            <label className="upload-button">
              {resume ? resume.name : '파일 업로드'}
              <input
                type="file"
                className="sr-only"
                accept=".pdf,.doc,.docx,.hwp,.hwpx"
                onChange={pickFile(setResume)}
              />
            </label>
          </div>
          <div className="file-field">
            <span className="file-field-label">
              포트폴리오 <em>선택 · PDF, DOC, DOCX, HWP · 10MB 이하</em>
            </span>
            <label className="upload-button">
              {portfolio ? portfolio.name : '파일 업로드'}
              <input
                type="file"
                className="sr-only"
                accept=".pdf,.doc,.docx,.hwp,.hwpx"
                onChange={pickFile(setPortfolio)}
              />
            </label>
          </div>
        </section>

        <section className="apply-section">
          <h2>지원정보</h2>
          <label>
            지원 경로
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">선택</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            자기소개 / 지원동기
            <textarea
              value={coverLetter}
              onChange={(e) => setCoverLetter(e.target.value)}
              maxLength={5000}
              rows={6}
            />
          </label>
        </section>

        <section className="apply-section">
          <h2>개인정보 수집 및 이용 동의</h2>
          <label className="consent-all">
            <input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} />
            <span>전체 동의</span>
          </label>
          {CONSENT_ITEMS.map((item) => (
            <ConsentItem
              key={item.key}
              item={item}
              checked={consents[item.key]}
              onToggle={(value) => setConsents((prev) => ({ ...prev, [item.key]: value }))}
            />
          ))}
        </section>

        <button type="submit" className="btn-primary btn-block" disabled={submitting}>
          {submitting ? '제출 중...' : '지원서 제출하기'}
        </button>
      </form>
    </div>
  )
}
