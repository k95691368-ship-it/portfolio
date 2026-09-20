import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { applicationAccess, hasApplicationAccess, clearApplicationAccess, newApplicationOperation } from '../lib/applicationSelfService.js'
import { formatKst } from '../lib/formatTime.js'
import { CONSENT_ITEMS, CONSENT_VERSION } from '../lib/consentText.js'
import Modal from '../components/Modal.jsx'
import UnsavedChangesGuard from '../components/UnsavedChangesGuard.jsx'
import './ApplicationManagePage.css'

const LABELS = { submitted: '심사 대기', passed: '서류합격', rejected: '불합격', withdrawn: '지원 철회' }
const CAREER_FIELDS = [['companyName', '회사명'], ['employmentType', '고용형태'], ['startDate', '입사일'], ['endDate', '퇴사일'], ['department', '부서'], ['position', '직급'], ['description', '담당 업무']]
const MAX_FILE_SIZE = 10 * 1024 * 1024
const UNCHANGED_REJECTIONS = new Set([400, 413, 415, 422, 429])
const draftValue = application => JSON.stringify(['applicantName', 'applicantPhone', 'applicationSource', 'coverLetter', 'career', 'consentOptional'].map(key => application?.[key]))

export default function ApplicationManagePage() {
  const [email, setEmail] = useState('')
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [applications, setApplications] = useState([])
  const [detail, setDetail] = useState(null)
  const [resume, setResume] = useState(null)
  const [portfolio, setPortfolio] = useState(null)
  const [removePortfolio, setRemovePortfolio] = useState(false)
  const [original, setOriginal] = useState(null)
  const [fileVersion, setFileVersion] = useState(0)
  const [recovery, setRecovery] = useState(null)
  const [discard, setDiscard] = useState(null)
  const exchange = useRef(null)
  const busyRef = useRef(false)
  const dirty = !!(verified && detail && original && (draftValue(detail) !== draftValue(original) || resume || portfolio || removePortfolio))

  const installDetail = application => {
    setDetail(application); setOriginal(application); setRecovery(null)
    setResume(null); setPortfolio(null); setRemovePortfolio(false)
    // File inputs are uncontrolled. Reset their DOM state with the held files.
    setFileVersion(value => value + 1)
  }
  const endAccess = () => {
    clearApplicationAccess(); setVerified(false); setApplications([])
    installDetail(null); setDiscard(null)
  }

  const fail = err => {
    setError(err.message)
    if (err.status === 401) endAccess()
  }
  const loadList = async () => {
    const data = await applicationAccess.list()
    setApplications(data.applications)
    setVerified(true)
    if (data.truncated) setMessage('최근 지원 100건까지 표시됩니다.')
  }
  useEffect(() => {
    let alive = true
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
    if (token && !exchange.current) {
      // Remove the email capability from the address bar before making requests.
      window.history.replaceState(window.history.state, '', window.location.pathname)
      exchange.current = applicationAccess.exchange(token)
    }
    const start = async () => {
      try {
        if (exchange.current) await exchange.current
        if (alive && hasApplicationAccess()) await loadList()
      } catch (err) { if (alive) fail(err) }
      finally { if (alive) setBusy(false) }
    }
    void start()
    return () => { alive = false }
  }, [])

  const run = async action => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setMessage('')
    try { await action() } catch (err) { fail(err) }
    finally { busyRef.current = false; setBusy(false) }
  }
  const requestLink = event => {
    event.preventDefault()
    void run(async () => setMessage((await applicationAccess.request(email)).message))
  }
  const discardThen = action => {
    if (busyRef.current) return
    if (dirty) setDiscard({ action })
    else void action()
  }
  const open = id => discardThen(() => run(async () => installDetail((await applicationAccess.get(id)).application)))
  const change = (field, value) => {
    if (!busyRef.current && !recovery) setDetail(previous => ({ ...previous, [field]: value }))
  }
  const chooseFile = (event, setFile) => {
    const file = event.target.files?.[0] || null
    if (file && (!file.size || file.size > MAX_FILE_SIZE)) {
      setFile(null); event.target.value = ''
      setError(file.size ? '첨부파일은 파일당 10MB 이하로 선택해주세요.' : '내용이 없는 파일은 첨부할 수 없습니다.')
      return
    }
    setFile(file)
  }
  const recoverMutation = async err => {
    // Validation/rate-limit responses are definite rejections: keep the draft.
    if (err.status === 401 || UNCHANGED_REJECTIONS.has(err.status)) throw err
    let latest = null
    try { latest = (await applicationAccess.get(detail.id)).application }
    catch (readError) { if (readError.status === 401) throw readError }
    // A timeout can still commit. Freeze mutations and preserve the visible
    // draft until the applicant explicitly accepts a fresh server snapshot.
    setRecovery({ latest })
    throw err
  }
  const refreshAfterMutation = async () => {
    try { await loadList() }
    catch (err) {
      if (err.status === 401) fail(err)
      else setError('변경 내용은 저장됐지만 지원 목록을 갱신하지 못했습니다. 지원 내역 새로고침을 눌러주세요.')
    }
  }
  const save = event => {
    event.preventDefault()
    if (recovery || !detail?.canEdit) return
    void run(async () => {
      const form = new FormData()
      for (const [key, value] of Object.entries({ applicantName: detail.applicantName, applicantPhone: detail.applicantPhone,
        applicationSource: detail.applicationSource, coverLetter: detail.coverLetter, careerJson: JSON.stringify(detail.career),
        consentOptional: String(detail.consentOptional), consentVersion: CONSENT_VERSION, revision: String(detail.revision),
        operationToken: newApplicationOperation(), removePortfolio: String(removePortfolio) })) form.append(key, value)
      if (resume) form.append('resume', resume)
      if (portfolio) form.append('portfolio', portfolio)
      let saved
      try { saved = (await applicationAccess.save(detail.id, form)).application }
      catch (err) { return recoverMutation(err) }
      installDetail(saved)
      setMessage('지원서 수정 내용을 저장했습니다. 수정된 내용으로 심사합니다.')
      await refreshAfterMutation()
    })
  }
  const withdraw = () => {
    if (recovery || !detail?.canWithdraw) return
    if (!window.confirm('이 지원을 철회하시겠습니까? 철회하면 서류 심사가 진행되지 않습니다.')) return
    void run(async () => {
      try {
        await applicationAccess.withdraw(detail.id, detail.revision)
        installDetail((await applicationAccess.get(detail.id)).application)
      } catch (err) { return recoverMutation(err) }
      setMessage('지원을 철회했습니다.')
      await refreshAfterMutation()
    })
  }
  const download = doc => run(async () => {
    const blob = await applicationAccess.file(detail.id, doc.id)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = doc.filename; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })

  return <div className="apply-page application-manage-page">
    <UnsavedChangesGuard when={dirty} message="저장하지 않은 지원서 수정 내용과 선택한 파일이 있습니다. 이동하면 입력한 내용이 사라집니다." />
    <header className="page-header"><Link to="/jobs" className="back-link">← 채용 공고</Link>
      <h1>내 지원서 관리</h1><p>접수번호를 확인하고, 심사 전 지원 내용을 수정하거나 지원을 철회할 수 있습니다.</p></header>
    {error && <p role="alert" className="error">{error}</p>}
    {message && <p role="status" className="notice">{message}</p>}
    {busy && <p role="status">처리 중...</p>}
    {!verified ? <section className="apply-section application-access-request">
      <h2>이메일로 본인 확인</h2><p>지원할 때 사용한 이메일로 확인 링크를 보냅니다. 계정 비밀번호나 접수번호가 없어도 됩니다.</p>
      <form onSubmit={requestLink} className="apply-form"><label>지원 이메일<input type="email" required value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" /></label>
        <button disabled={busy} className="btn-primary">확인 링크 받기</button></form>
    </section> : <>
      <div className="modal-actions"><button disabled={busy} onClick={() => void run(loadList)}>지원 내역 새로고침</button>
        <button disabled={busy} onClick={() => discardThen(endAccess)}>확인 종료</button></div>
      <section className="apply-section"><h2>지원 내역</h2>
        {!applications.length && <p>이 이메일로 접수된 지원 내역이 없습니다.</p>}
        <div className="my-app-list">{applications.map(application => <article className="my-app-card" key={application.id}>
          <h3>{application.postingTitle}</h3><p>{LABELS[application.status]} · 접수 {formatKst(application.createdAt)}</p>
          <p>접수번호 <code>{application.lookupCode}</code></p>
          <button type="button" disabled={busy} onClick={() => void open(application.id)}>제출 내용 보기</button>
        </article>)}</div>
      </section>
      {detail && <section className="apply-section"><h2>{detail.postingTitle} — 제출 내용</h2>
        <p>{LABELS[detail.status]} · 접수번호 <code>{detail.lookupCode}</code></p>
        {!detail.canEdit && <p className="notice">모집이 마감되거나 심사가 완료된 지원서는 수정할 수 없습니다.</p>}
        {recovery && <section className="notice" aria-label="저장 결과 확인">
          <h3>저장 결과를 먼저 확인해주세요</h3>
          <p>아래 입력과 파일 선택은 보관했습니다. 중복 변경을 막기 위해 수정·철회를 잠시 중단했습니다. 서버의 제출 내용을 확인하고 다시 열어주세요.</p>
          {recovery.latest ? <details><summary>현재 서버에 저장된 제출 내용 확인</summary>
            <p>{LABELS[recovery.latest.status]} · 이름: {recovery.latest.applicantName} · 연락처: {recovery.latest.applicantPhone}</p>
            <p>지원 경로: {recovery.latest.applicationSource || '없음'}</p><p>자기소개: {recovery.latest.coverLetter || '없음'}</p>
            <p>선택 정보 동의: {recovery.latest.consentOptional ? '동의' : '미동의'}</p>
            <ul>{recovery.latest.career.map((career, index) => <li key={index}>{CAREER_FIELDS.map(([key, label]) => `${label}: ${career[key] || '-'}`).join(' · ')}{career.current ? ' · 재직 중' : ''}</li>)}</ul>
            <ul>{recovery.latest.documents.map(doc => <li key={doc.id}>{doc.filename}</li>)}</ul>
          </details> : <p>현재 제출 내용을 불러오지 못했습니다. 연결을 확인한 후 다시 확인해주세요.</p>}
          <div className="modal-actions">
            <button type="button" disabled={busy} onClick={() => void run(async () => {
              const latest = (await applicationAccess.get(detail.id)).application
              setRecovery({ latest }); setMessage('현재 제출 내용을 확인했습니다. 내용을 비교한 뒤 다시 열어주세요.')
            })}>저장 결과 다시 확인</button>
            <button type="button" disabled={busy || !recovery.latest} onClick={() => discardThen(() => {
              installDetail(recovery.latest); setError(''); setMessage('서버의 최신 제출 내용으로 다시 열었습니다. 이전 수정 입력과 파일 선택은 초기화했습니다.')
            })}>최신 제출 내용으로 다시 열기</button>
          </div>
        </section>}
        <form onSubmit={save} className="apply-form application-edit-form" key={`${detail.id}:${detail.revision}:${fileVersion}`}>
          <fieldset className="apply-section" disabled={busy || !detail.canEdit || !!recovery}><legend>지원 정보</legend>
            <label>이름<input required maxLength={100} value={detail.applicantName} onChange={event => change('applicantName', event.target.value)} /></label>
            <label>이메일<input type="email" readOnly value={detail.applicantEmail} /></label>
            <p className="notice">본인 확인에 사용한 이메일은 이 화면에서 변경되지 않습니다.</p>
            <label>연락처<input required maxLength={40} value={detail.applicantPhone} onChange={event => change('applicantPhone', event.target.value)} /></label>
            <label>지원 경로<input maxLength={200} value={detail.applicationSource} onChange={event => change('applicationSource', event.target.value)} /></label>
            <label>자기소개<textarea maxLength={5000} rows={5} value={detail.coverLetter} onChange={event => change('coverLetter', event.target.value)} /></label>
          </fieldset>
          <fieldset className="apply-section" disabled={busy || !detail.canEdit || !!recovery}><legend>경력사항</legend>
            {detail.career.map((career, index) => <div className="career-entry" key={index}>
              {CAREER_FIELDS.map(([key, label]) => <label key={key}>{label}<input value={career[key] || ''} maxLength={500}
                onChange={event => change('career', detail.career.map((row, i) => i === index ? { ...row, [key]: event.target.value } : row))} /></label>)}
              <label className="checkbox-label"><input type="checkbox" checked={!!career.current} onChange={event => change('career', detail.career.map((row, i) => i === index ? { ...row, current: event.target.checked } : row))} />재직 중</label>
              <button type="button" onClick={() => change('career', detail.career.filter((_, i) => i !== index))}>이 경력 삭제</button>
            </div>)}
            <button type="button" disabled={detail.career.length >= 20} onClick={() => change('career', [...detail.career, {}])}>경력 추가</button>
          </fieldset>
          <fieldset className="apply-section" disabled={busy || !detail.canEdit || !!recovery}><legend>첨부파일 변경</legend>
            <label>이력서 교체<input type="file" accept=".pdf,.doc,.docx,.hwp,.hwpx" onChange={event => chooseFile(event, setResume)} /></label>
            <label>포트폴리오 교체<input type="file" accept=".pdf,.doc,.docx,.hwp,.hwpx" onChange={event => chooseFile(event, setPortfolio)} /></label>
            <p className="notice">PDF, DOC, DOCX, HWP, HWPX · 파일당 10MB 이하. 선택하지 않으면 기존 파일을 유지합니다.</p>
            <label className="checkbox-label"><input type="checkbox" checked={removePortfolio} onChange={event => setRemovePortfolio(event.target.checked)} />기존 포트폴리오 제거</label>
          </fieldset>
          <fieldset className="apply-section" disabled={busy || !detail.canEdit || !!recovery}><legend>선택 정보 동의</legend>
            <label className="checkbox-label"><input type="checkbox" checked={detail.consentOptional} onChange={event => change('consentOptional', event.target.checked)} />경력·자기소개·지원 경로·포트폴리오 수집·이용 동의 (선택)</label>
            <details><summary>선택항목 수집·이용 내용</summary><pre className="consent-text">{CONSENT_ITEMS.find(item => item.key === 'consentOptional')?.text}</pre></details>
            <button className="btn-primary" type="submit">수정 내용 저장</button>
          </fieldset>
        </form>
        <h3>현재 제출한 파일</h3><ul>{(recovery?.latest || detail).documents.map(doc => <li key={doc.id}><button disabled={busy || !!recovery && !recovery.latest} onClick={() => void download(doc)}>{doc.filename} 다운로드</button></li>)}</ul>
        {detail.canWithdraw && <button className="btn-danger" disabled={busy || !!recovery} onClick={withdraw}>지원 철회</button>}
      </section>}
    </>}
    {discard && <Modal title="저장하지 않은 지원서 수정 내용" onClose={() => setDiscard(null)}>
      <h2>저장하지 않은 수정 내용이 있습니다</h2>
      <p>계속하면 입력한 수정 내용과 선택한 파일이 사라집니다.</p>
      <div className="modal-actions">
        <button type="button" onClick={() => setDiscard(null)}>계속 작성</button>
        <button type="button" className="btn-danger" onClick={() => { const action = discard.action; setDiscard(null); void action() }}>수정 내용 버리고 계속</button>
      </div>
    </Modal>}
  </div>
}
