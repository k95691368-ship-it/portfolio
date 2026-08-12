import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import SignatureModal from '../components/SignatureModal.jsx'
import ContractExplainer from '../components/ContractExplainer.jsx'
import AuditCertificate from '../components/AuditCertificate.jsx'
import WageComposition from '../components/WageComposition.jsx'
import WorkerRights from '../components/WorkerRights.jsx'
import SeverityBadge from '../components/SeverityBadge.jsx'
import { EMPTY_FORM, formFromTerms } from '../lib/contractForm.js'
import { formatKst } from '../lib/formatTime.js'
import { IDENTITY_FIELDS, TERM_FIELDS, SOCIAL_INSURANCE_FIELDS } from '../lib/contractTemplate.js'

const FIELD_LABELS = {
  ...Object.fromEntries([...IDENTITY_FIELDS, ...TERM_FIELDS].map((f) => [f.key, f.label])),
  socialInsurance: '사회보험 적용',
  customTerms: '그 밖의 사항',
}

function formatHistoryValue(field, value) {
  if (value === null || value === undefined || value === '') return '(비어 있음)'
  if (field === 'socialInsurance') {
    try {
      const obj = JSON.parse(value)
      const on = SOCIAL_INSURANCE_FIELDS.filter((f) => obj[f.key]).map((f) => f.label)
      return on.length > 0 ? on.join(', ') : '(없음)'
    } catch {
      return String(value)
    }
  }
  if (field === 'customTerms') {
    try {
      const arr = JSON.parse(value)
      return arr.map((c) => `${c.label}: ${c.value}`).join(', ') || '(없음)'
    } catch {
      return String(value)
    }
  }
  return String(value)
}



// 외국인 근로자용 번역본 — 원본과 나란히 보여준다(공식 표준근로계약서 외국어본 방식).
function ContractTranslations({
  translations,
  sourceArticles,
  languages,
  canTranslate,
  onTranslate,
  busy,
}) {
  const [language, setLanguage] = useState(languages[0]?.code ?? 'en')
  // useState 초기값은 첫 렌더에만 쓰인다. 계약서 화면은 한 번만 마운트되므로,
  // 번역이 없던 상태에서 잡힌 null 이 그대로 남아 번역을 마쳐도 아무것도
  // 펼쳐지지 않았다. "아직 고르지 않음"과 "사용자가 접음"을 구분해, 고르지
  // 않았으면 가장 최근 번역을 보여 준다.
  const [shown, setShown] = useState(undefined)
  const effectiveShown = shown === undefined ? (translations[translations.length - 1]?.language ?? null) : shown

  const current = translations.find((t) => t.language === effectiveShown) ?? null

  if (!canTranslate && translations.length === 0) return null

  return (
    <section className="contract-translation">
      <h2>외국어 계약서</h2>
      <p className="translation-note">
        법적 효력은 한국어 원본에 있으며, 번역본은 근로자가 내용을 정확히 이해하도록 돕기 위한
        참고본입니다.
      </p>

      {canTranslate && (
        <div className="translation-controls">
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.nativeLabel})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || sourceArticles.length === 0}
            onClick={() => onTranslate(language)}
          >
            {busy ? '번역 중...' : '이 언어로 번역하기'}
          </button>
          {sourceArticles.length === 0 && (
            <span className="translation-hint">계약 조건을 먼저 입력해주세요.</span>
          )}
        </div>
      )}

      {translations.length > 0 && (
        <div className="translation-tabs">
          {translations.map((t) => (
            <button
              key={t.language}
              type="button"
              className={`btn-sm${effectiveShown === t.language ? ' active' : ''}`}
              onClick={() => setShown(effectiveShown === t.language ? null : t.language)}
            >
              {t.nativeLabel}
              {t.stale !== false && <span className="translation-stale-mark"> ⚠</span>}
            </button>
          ))}
        </div>
      )}

      {/* 번역한 뒤에 조건이 바뀌었으면, 지금 보이는 번역본은 지금 계약서의
          번역이 아니다. 한국어를 읽지 못하는 사람은 스스로 확인할 방법이 없다. */}
      {current && current.stale !== false && (
        <p className="translation-alert" role="alert">
          {current.stale
            ? '이 번역본을 만든 뒤 계약 조건이 바뀌었습니다. 지금 계약서와 다른 내용이므로, 다시 번역한 뒤 확인해주세요.'
            : '이 번역본이 어느 시점의 내용을 옮긴 것인지 확인할 수 없습니다. 정확한 대조가 필요하면 다시 번역해주세요.'}
        </p>
      )}

      {current && (
        <div className="translation-body">
          {current.articles.map((a, i) => (
            <div className="translation-row" key={i}>
              <div className="translation-source">
                <strong>{sourceArticles[i]?.heading}</strong>
                <p>{sourceArticles[i]?.body}</p>
              </div>
              <div className="translation-target" lang={current.language}>
                <strong>{a.heading}</strong>
                <p>{a.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const PERIOD_BADGE = {
  open_ended: 'badge-accent',
  scheduled: 'badge-neutral',
  active: 'badge-success',
  expiring_soon: 'badge-warning',
  expired: 'badge-danger',
  unknown: 'badge-neutral',
}

// 근로관계가 실제로 끝난 날 — 보존 기간(제42조)의 기산일.
function EmploymentEnd({ employmentEnd, canRecord, onRecord, onClear, busy }) {
  const [endedOn, setEndedOn] = useState('')
  const [reason, setReason] = useState('')

  if (!canRecord && !employmentEnd?.endedAt) return null

  if (employmentEnd?.endedAt) {
    return (
      <div className="employment-end">
        <p className="period-detail">
          근로관계 종료 <strong>{employmentEnd.endedAt}</strong>
          {employmentEnd.reason && ` · ${employmentEnd.reason}`}
        </p>
        {canRecord && (
          <button type="button" className="btn-sm" onClick={onClear} disabled={busy}>
            종료 기록 취소
          </button>
        )}
      </div>
    )
  }

  return (
    <form
      className="employment-end"
      onSubmit={(e) => {
        e.preventDefault()
        onRecord({ endedOn, reason })
      }}
    >
      <p className="period-detail">
        근로관계가 끝났다면 그 날짜를 기록해주세요. 보존 기간 3년은 계약 종료일이 아니라 실제로 근로관계가
        끝난 날부터 셉니다 (근로기준법 시행령 제22조 제2항).
      </p>
      <div className="career-row">
        <label>
          근로관계 종료일
          <input type="date" value={endedOn} onChange={(e) => setEndedOn(e.target.value)} required />
        </label>
        <label>
          사유 (선택)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder="예: 계약기간 만료"
          />
        </label>
      </div>
      <button type="submit" className="btn-sm" disabled={busy || !endedOn}>
        종료 기록하기
      </button>
    </form>
  )
}

// 계약 기간 — 체결로 끝이 아니라 만료까지 관리해야 한다.
// 이어진 계약(갱신) — 계속근로기간 합산과 보존 의무 기간
function ContractLifecycle({
  continuity,
  retention,
  linkableRooms,
  canLink,
  onLink,
  onUnlink,
  busy,
  employmentEnd,
  canRecordEnd,
  onRecordEnd,
  onClearEnd,
}) {
  const [selected, setSelected] = useState('')
  const showPicker = canLink && linkableRooms.length > 0
  if (!continuity?.linked && !retention?.known && !showPicker && !canRecordEnd) return null

  return (
    <section className="contract-lifecycle">
      <h2>계약 이력과 보존</h2>

      {continuity?.linked && (
        <>
          <p className="period-detail">
            이어진 계약 {continuity.count}건 · 계속근로기간 약 {continuity.totalMonths}개월 (
            {continuity.startDate} ~ {continuity.endDate ?? '진행 중'})
          </p>
          <ol className="lifecycle-chain">
            {continuity.segments.map((s) => (
              <li key={s.roomId}>
                <span>{s.title}</span>
                <span className="lifecycle-dates">
                  {s.startDate} ~ {s.endDate ?? '진행 중'}
                </span>
              </li>
            ))}
          </ol>
          {continuity.exceedsFixedTermLimit && (
            <p className="period-alert">
              계약 하나하나는 2년 이내지만 이어서 보면 2년을 넘습니다. 기간제법 제4조에 따라 기간의
              정함이 없는 근로계약으로 보게 될 수 있습니다.
            </p>
          )}
          {continuity.truncated && (
            <p className="period-alert">
              이어진 계약이 너무 많아 일부까지만 합산했습니다. 실제 계속근로기간은 아래에 표시된
              것보다 깁니다.
            </p>
          )}
          {continuity.gaps?.length > 0 && (
            <p className="period-detail">
              계약 사이에 {continuity.gaps.map((g) => `${g.days}일`).join(', ')}의 공백이 있어 계속근로로
              볼지는 실제 근무 여부에 따라 달라질 수 있습니다.
            </p>
          )}
          {canLink && (
            <button type="button" className="btn-sm" onClick={onUnlink} disabled={busy}>
              연결 해제
            </button>
          )}
        </>
      )}

      {showPicker && !continuity?.linked && (
        <div className="lifecycle-link">
          <p className="period-detail">
            이 계약이 이전 계약의 갱신이라면 이어두세요. 계속근로기간을 합산해 2년 상한을 함께
            봅니다.
          </p>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">이전 계약 선택</option>
            {linkableRooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} ({r.startDate ?? '개시일 미기재'} ~ {r.endDate ?? '종료일 없음'})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-sm"
            onClick={() => onLink(selected)}
            disabled={busy || !selected}
          >
            이전 계약으로 연결
          </button>
        </div>
      )}

      {retention?.known && (
        <p className={retention.expired ? 'period-alert' : 'period-detail'}>
          {/* 재직 중은 "보존 의무가 계속된다"는 뜻이지 문제가 아니다. 만료가
              지난 경우만 눈에 띄게 표시한다. */}
          <span className={`badge ${retention.expired ? 'badge-warning' : 'badge-neutral'}`}>
            {retention.label}
          </span>{' '}
          {retention.detail}
        </p>
      )}

      <EmploymentEnd
        employmentEnd={employmentEnd}
        canRecord={canRecordEnd}
        onRecord={onRecordEnd}
        onClear={onClearEnd}
        busy={busy}
      />
    </section>
  )
}

function ContractPeriod({ period }) {
  if (!period?.known) return null

  return (
    <section className="contract-period">
      <div className="period-head">
        <h2>계약 기간</h2>
        <span className={`badge ${PERIOD_BADGE[period.status] || 'badge-neutral'}`}>
          {period.label}
        </span>
      </div>

      {period.openEnded ? (
        <p className="period-detail">
          {period.startDate} 개시 · {period.detail}
        </p>
      ) : (
        <>
          <p className="period-detail">
            {period.startDate ?? '개시일 미기재'} ~ {period.endDate}
            {period.months !== null && ` · 약 ${period.months}개월`}
          </p>
          {period.status === 'expiring_soon' && (
            <p className="period-alert">
              계약 만료가 {period.remainingDays}일 남았습니다. 갱신 또는 종료 여부를 상대방에게 미리
              안내해주세요.
            </p>
          )}
          {period.status === 'expired' && (
            <p className="period-alert">
              계약 기간이 종료되었습니다. 계속 근무 중이라면 갱신 계약을 새로 체결해야 합니다.
            </p>
          )}
          {period.exceedsFixedTermLimit && (
            <p className="period-alert">
              기간이 2년을 초과합니다. 기간제법 제4조에 따라 기간의 정함이 없는 근로계약으로 보게 될 수
              있습니다.
            </p>
          )}
        </>
      )}
    </section>
  )
}
const REQUEST_STATUS = {
  pending: { label: '검토 중', badge: 'badge-warning' },
  accepted: { label: '반영됨', badge: 'badge-success' },
  declined: { label: '반려됨', badge: 'badge-neutral' },
}

// 계약 조건 수정 요청 — 지원자가 보내고 회사가 수락·거절한다.
function ChangeRequests({ requests, myRole, canRequest, canRespond, onCreate, onRespond, busy, prefill }) {
  const [field, setField] = useState('')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')

  // 점검 결과에서 "이 값으로 수정 요청"을 누르면 폼이 채워진 채로 열린다.
  useEffect(() => {
    if (!prefill) return
    setField(prefill.field)
    setValue(prefill.requestedValue)
    setReason(prefill.reason)
  }, [prefill])

  const submit = async (e) => {
    e.preventDefault()
    // 실패해도 입력을 지우고 있었다. 오류 토스트는 몇 초 뒤 사라지고 폼은
    // 비어 있으므로, 보낸 것으로 착각하고 회사의 답을 기다리게 된다.
    const sent = await onCreate({ field, requestedValue: value, reason })
    if (!sent) return
    setField('')
    setValue('')
    setReason('')
  }

  const pending = requests.filter((r) => r.status === 'pending')
  const resolved = requests.filter((r) => r.status !== 'pending')

  return (
    <section className="change-requests">
      <h2>계약 조건 수정 요청</h2>

      {pending.length === 0 && resolved.length === 0 && (
        <p className="notice">
          {myRole === 'candidate'
            ? '계약 내용 중 다르게 합의했거나 조정이 필요한 항목이 있으면 수정을 요청할 수 있습니다.'
            : '지원자가 보낸 수정 요청이 여기에 표시됩니다.'}
        </p>
      )}

      {pending.length > 0 && (
        <ul className="request-list">
          {pending.map((r) => (
            <li key={r.id} className="request-item">
              <div className="request-head">
                <strong>{r.label}</strong>
                <span className={`badge ${REQUEST_STATUS.pending.badge}`}>검토 중</span>
              </div>
              <p className="request-values">
                <span className="request-from">{r.currentValue || '(비어 있음)'}</span>
                {' → '}
                <span className="request-to">{r.requestedValue}</span>
              </p>
              {r.reason && <p className="request-reason">사유: {r.reason}</p>}
              {/* 잠긴 방에서는 응답도 막힌다(서버가 409). 버튼만 남겨 두면
                  눌러 봐야 안 되는 화면이 된다. */}
              {myRole === 'company' && canRespond && (
                <div className="request-actions">
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={busy}
                    onClick={() => onRespond(r.id, 'accept')}
                  >
                    수락하고 계약서에 반영
                  </button>
                  <button
                    type="button"
                    className="btn-sm"
                    disabled={busy}
                    onClick={() => onRespond(r.id, 'decline')}
                  >
                    거절
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <ul className="request-list resolved">
          {resolved.map((r) => (
            <li key={r.id} className="request-item">
              <div className="request-head">
                <strong>{r.label}</strong>
                <span className={`badge ${REQUEST_STATUS[r.status].badge}`}>
                  {REQUEST_STATUS[r.status].label}
                </span>
              </div>
              <p className="request-values">
                <span className="request-from">{r.currentValue || '(비어 있음)'}</span>
                {' → '}
                <span className="request-to">{r.requestedValue}</span>
              </p>
              {r.responseNote && <p className="request-reason">회사 회신: {r.responseNote}</p>}
            </li>
          ))}
        </ul>
      )}

      {canRequest && (
        <form className="request-form" onSubmit={submit}>
          <div className="career-row">
            <label>
              항목
              <select value={field} onChange={(e) => setField(e.target.value)} required>
                <option value="">선택</option>
                {[...IDENTITY_FIELDS, ...TERM_FIELDS].map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              요청하는 값
              <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={500} required />
            </label>
          </div>
          <label>
            사유 (선택)
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="예: 면접에서 합의한 금액과 다릅니다."
            />
          </label>
          <button type="submit" className="btn-primary" disabled={busy}>
            수정 요청 보내기
          </button>
        </form>
      )}
    </section>
  )
}

// 서명 전 최종 안전 점검 — 합의 불일치 / 법적 문제 / 필수 누락
function PreSignCheck({ check, onRequestFix, onRedraft, redrafting }) {
  const { diffs, legalIssues, missingFields } = check
  const doc = check.documentCheck ?? { hasDocument: false, issues: [], missingArticles: [] }
  const clean =
    diffs.length === 0 &&
    legalIssues.length === 0 &&
    missingFields.length === 0 &&
    doc.issues.length === 0 &&
    doc.missingArticles.length === 0

  return (
    <section className={`presign-check${clean ? ' clean' : ''}`}>
      <h3>서명 전 최종 확인</h3>

      {clean && (
        <p className="presign-ok">
          ✓ 채팅에서 합의한 조건과 계약서 내용이 일치하며, 계약서 본문도 조건과 같습니다. 법적 검토에서도
          문제가 발견되지 않았습니다.
        </p>
      )}

      {doc.issues.length > 0 && (
        <div className="presign-group">
          <p className="presign-group-title">
            <span className="badge badge-danger">본문과 조건이 다름</span> 실제로 서명·보관되는 것은
            아래 계약서 본문입니다.
          </p>
          <ul className="presign-list">
            {doc.issues.map((issue) => (
              <li key={issue.field}>
                <SeverityBadge severity={issue.severity}>{issue.label}</SeverityBadge>{' '}
                {issue.message}
              </li>
            ))}
          </ul>
          {onRedraft && (
            <button type="button" className="btn-sm" onClick={onRedraft} disabled={redrafting}>
              {redrafting ? '본문을 다시 쓰는 중...' : '현재 조건으로 본문 다시 작성'}
            </button>
          )}
          {doc.issues.some((i) => i.conflict) && (
            <p className="presign-missing">
              본문에 다른 금액이 적혀 있어 이 상태로는 서명할 수 없습니다. 본문을 다시 작성해주세요.
            </p>
          )}
        </div>
      )}

      {doc.missingArticles.length > 0 && (
        <div className="presign-group">
          <p className="presign-group-title">
            <span className="badge badge-warning">본문 필수 조항 누락</span>
          </p>
          <p className="presign-missing">
            계약서 본문에 {doc.missingArticles.map((m) => m.label).join(', ')} 관련 내용이 보이지
            않습니다. (근로기준법 제17조 명시사항)
          </p>
        </div>
      )}

      {diffs.length > 0 && (
        <div className="presign-group">
          <p className="presign-group-title">
            <span className="badge badge-danger">합의 내용과 다름</span> 면접 대화에서 합의된 조건이 이후 수정되었습니다.
          </p>
          <table className="presign-table">
            <thead>
              <tr>
                <th scope="col">항목</th>
                <th scope="col">대화에서 합의</th>
                <th scope="col">현재 계약서</th>
                {onRequestFix && <th scope="col"><span className="sr-only">수정 요청</span></th>}
              </tr>
            </thead>
            <tbody>
              {diffs.map((d) => (
                <tr key={d.field}>
                  <td>{d.label}</td>
                  <td className="presign-agreed">{d.agreed}</td>
                  <td className="presign-current">{d.current}</td>
                  {onRequestFix && (
                    <td>
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() =>
                          onRequestFix({
                            field: d.field,
                            requestedValue: d.agreed.replace(/,/g, ''),
                            reason: `면접에서 합의한 ${d.label}(${d.agreed})과(와) 다릅니다.`,
                          })
                        }
                      >
                        합의대로 요청
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {legalIssues.length > 0 && (
        <div className="presign-group">
          <p className="presign-group-title">법적 검토</p>
          <ul className="presign-list">
            {legalIssues.map((issue, i) => (
              <li key={i}>
                <SeverityBadge severity={issue.severity}>{issue.title}</SeverityBadge>{' '}
                {issue.detail}
                {onRequestFix && issue.field && issue.suggestedValue && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={() =>
                        onRequestFix({
                          field: issue.field,
                          requestedValue: issue.suggestedValue,
                          reason: `${issue.title} — ${issue.detail}`,
                        })
                      }
                    >
                      최소 적법 금액으로 요청
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {missingFields.length > 0 && (
        <div className="presign-group">
          <p className="presign-group-title">
            <span className="badge badge-warning">필수 항목 누락</span>
          </p>
          <p className="presign-missing">
            {missingFields.map((m) => m.label).join(', ')} 항목이 비어 있습니다. (근로기준법 제17조 명시사항)
          </p>
        </div>
      )}
    </section>
  )
}

export default function ContractPage() {
  const { roomId } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  const [room, setRoom] = useState(null)
  const [contractMeta, setContractMeta] = useState({ hireConfirmed: false })
  const [form, setForm] = useState(EMPTY_FORM)
  // 지금 화면의 값과 서버에서 마지막으로 받은 값. 둘이 다르면 저장하지 않은
  // 입력이 있다는 뜻이다.
  const formRef = useRef(form)
  formRef.current = form
  const savedFormRef = useRef(EMPTY_FORM)
  const [serverChangedWhileEditing, setServerChangedWhileEditing] = useState(false)
  const [signatures, setSignatures] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [offerWarning, setOfferWarning] = useState(null)
  const [signingRole, setSigningRole] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [aiDocument, setAiDocument] = useState(null)
  const [drafting, setDrafting] = useState(false)
  const [history, setHistory] = useState([])
  const [auditTrail, setAuditTrail] = useState(null)
  const [signedContract, setSignedContract] = useState(null)
  const [signedMeta, setSignedMeta] = useState({ emailConfigured: true, candidateEmailMasked: null })
  const [storing, setStoring] = useState(false)
  const [preSign, setPreSign] = useState(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [changeRequests, setChangeRequests] = useState([])
  const [requestBusy, setRequestBusy] = useState(false)
  const [requestPrefill, setRequestPrefill] = useState(null)
  const [confirmingHire, setConfirmingHire] = useState(false)
  const [period, setPeriod] = useState(null)
  const [translations, setTranslations] = useState([])
  // 번역 가능한 언어는 서버가 정한다. 화면이 따로 적어 두면 목록이 갈라진다.
  const [languages, setLanguages] = useState([])
  const [sourceArticles, setSourceArticles] = useState([])
  const [translating, setTranslating] = useState(false)
  const [explanation, setExplanation] = useState(null)
  const [postingComparison, setPostingComparison] = useState(null)
  const [deliveries, setDeliveries] = useState([])
  const [deliveryState, setDeliveryState] = useState(null)
  const [documentSha256, setDocumentSha256] = useState(null)
  // 임금 구성항목은 인쇄는 되는데 지문에는 들어가지 않는다. 지문만 보면
  // 식대만 바꾼 변경을 놓치므로, 화면이 읽은 시각도 함께 들고 있다가 보낸다.
  const [termsUpdatedAt, setTermsUpdatedAt] = useState(null)
  const [revokedSignatures, setRevokedSignatures] = useState([])
  const [continuity, setContinuity] = useState(null)
  const [retention, setRetention] = useState(null)
  // 근로관계가 실제로 끝난 날. 계약 조건이 아니라 그 뒤에 일어난 사실이므로
  // 계약서 입력 폼과 분리해 둔다.
  const [employmentEnd, setEmploymentEnd] = useState({ endedAt: null, reason: null })
  const [certificates, setCertificates] = useState([])
  const [wageComposition, setWageComposition] = useState(null)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [workerRights, setWorkerRights] = useState(null)
  const [linkableRooms, setLinkableRooms] = useState([])
  const [linking, setLinking] = useState(false)
  const printRef = useRef(null)

  const loadAll = useCallback(async () => {
    // 이 화면에 필요한 모든 정보를 한 번의 요청으로 받는다.
    const view = await api.get(`/rooms/${roomId}/contract-view`)
    const roomData = view.room
    const contractData = view.contract
    const sigData = { signatures: view.signatures }
    const historyData = { history: view.history }
    const auditData = view.auditTrail
    const preSignData = view.preSignCheck
    const storedData = view.signedContract
    setAuditTrail(auditData)
    setRoom(roomData)
    setHistory(historyData.history ?? [])
    setContractMeta({
      hireConfirmed: contractData.hireConfirmed,
      hireConfirmedAt: contractData.hireConfirmedAt,
      confirmationExcerpt: contractData.confirmationExcerpt,
    })
    setAiDocument(contractData.terms?.aiDocument ?? null)

    const nextForm = formFromTerms(contractData.terms, roomData.participants)

    // 저장하지 않은 입력을 서버 값으로 덮어쓰지 않는다.
    //
    // loadAll 은 채용 확정·수정 요청 응답·이전 계약 연결 등 거의 모든 동작
    // 뒤에 불린다. 그때마다 폼을 서버 값으로 되돌리고 있었으므로, 회사가
    // 임금을 고치던 중에 다른 버튼을 한 번 누르면 입력한 내용이 사라지고
    // "처리되었습니다" 토스트만 뜬다. 무엇이 사라졌는지 알 방법이 없다.
    const dirty = JSON.stringify(formRef.current) !== JSON.stringify(savedFormRef.current)
    const serverChanged = JSON.stringify(nextForm) !== JSON.stringify(savedFormRef.current)
    savedFormRef.current = nextForm
    if (!dirty) {
      setForm(nextForm)
      setServerChangedWhileEditing(false)
    } else if (serverChanged) {
      // 내 입력은 지키되, 서버 쪽도 바뀌었다는 사실은 알린다.
      setServerChangedWhileEditing(true)
    }

    const t = contractData.terms || {}
    setEmploymentEnd({ endedAt: t.employmentEndedAt ?? null, reason: t.employmentEndReason ?? null })
    setSignatures(sigData.signatures)
    setChangeRequests(view.changeRequests ?? [])
    setPeriod(view.period ?? null)
    setExplanation(view.explanation ?? null)
    setPostingComparison(view.postingComparison ?? null)
    setDeliveries(view.deliveries ?? [])
    setDeliveryState(view.deliveryState ?? null)
    setDocumentSha256(view.documentSha256 ?? null)
    setTermsUpdatedAt(view.contract?.updatedAt ?? view.updatedAt ?? null)
    setRevokedSignatures(view.revokedSignatures ?? [])
    setCertificates(view.certificates ?? [])
    setWageComposition(view.wageComposition ?? null)
    setHistoryTotal(view.historyTotal ?? 0)
    setWorkerRights(view.workerRights ?? null)
    setContinuity(view.continuity ?? null)
    setRetention(view.retention ?? null)
    setLinkableRooms(view.linkableRooms ?? [])
    setTranslations(view.translations ?? [])
    setLanguages(view.languages ?? [])
    setSourceArticles(view.sourceArticles ?? [])

    // 서명 전 최종 안전 점검은 아직 체결되지 않은 계약서에만 보여준다.
    setPreSign(roomData.status === 'signed' ? null : preSignData)
    // 점검 결과를 다시 읽었으면 "모두 검토했다"는 확인도 다시 받는다.
    //
    // 체크는 한 번 누르면 그대로 남아 있었다. 그런데 그 사이 조건이 바뀌어
    // 새 위반이 생겨도 체크는 켜진 채이므로, 본 적 없는 문제까지 동의한
    // 것이 된다. 이 체크는 서명을 여는 유일한 문이다.
    setAcknowledged(false)

    if (roomData.status === 'signed' && storedData) {
      setSignedContract(storedData.stored)
      setSignedMeta({
        emailConfigured: storedData.emailConfigured,
        candidateEmailMasked: storedData.candidateEmailMasked,
      })
    }
  }, [roomId])

  useEffect(() => {
    loadAll()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [loadAll])

  const updateField = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const toggleInsurance = (key) =>
    setForm((f) => ({ ...f, socialInsurance: { ...f.socialInsurance, [key]: !f.socialInsurance[key] } }))
  const updateCustomTerm = (idx, field, value) =>
    setForm((f) => {
      const next = [...f.customTerms]
      next[idx] = { ...next[idx], [field]: value }
      return { ...f, customTerms: next }
    })
  const addCustomTerm = () => setForm((f) => ({ ...f, customTerms: [...f.customTerms, { label: '', value: '' }] }))
  const removeCustomTerm = (idx) =>
    setForm((f) => ({ ...f, customTerms: f.customTerms.filter((_, i) => i !== idx) }))

  const isSigned = room?.status === 'signed'
  // 보관된 방은 계약서가 잠긴다 — 수정도 서명도 파일 저장도.
  const archived = !!room?.archivedAt
  // 종료된 전형도 계약을 앞으로 진행하는 행동은 전부 막힌다(서버가 409).
  // 그런데 화면은 그것을 보지 않아, 끝난 전형에서 아무 표시 없이 조건을
  // 고치고 서명할 수 있는 것처럼 보였다.
  const roomClosed = room?.status === 'closed'
  // 계약을 앞으로 진행할 수 없는 상태를 한 이름으로 묶는다. 여기저기서
  // 따로 확인하게 두면 한 곳을 빠뜨린다 — 실제로 그렇게 빠뜨렸다.
  const frozen = archived || roomClosed
  const myRole = room?.myRole
  const otherRole = myRole === 'company' ? 'candidate' : 'company'
  const mySignature = signatures.find((s) => s.role === myRole)
  const otherSignature = signatures.find((s) => s.role === otherRole)
  const canEdit = !isSigned && !frozen && myRole === 'company'

  const handleSave = async () => {
    setSaving(true)
    try {
      const filteredCustomTerms = form.customTerms.filter((c) => c.label && c.value)
      const droppedCount = form.customTerms.length - filteredCustomTerms.length
      // 이름도 금액도 비어 있는 줄은 보내지 않는다.
      const filteredWageItems = (form.wageItems ?? []).filter(
        (w) => String(w.name ?? '').trim() !== '' || String(w.amount ?? '').trim() !== ''
      )
      const payload = {
        ...form,
        wageBaseAmount: form.wageBaseAmount === '' || form.wageBaseAmount === null ? null : Number(form.wageBaseAmount),
        customTerms: filteredCustomTerms,
        wageItems: filteredWageItems.map((w) => ({ ...w, amount: Number(w.amount) })),
      }
      const saved = await api.patch(`/rooms/${roomId}/contract`, payload)
      // 확정 뒤의 불리한 변경은 실질적으로 취소일 수 있다. 토스트는 5초 뒤
      // 사라지므로, 이 경고는 화면에 남겨 둔다.
      setOfferWarning(saved?.offerWarning ?? null)
      setForm((f) => ({ ...f, customTerms: filteredCustomTerms }))
      // 저장했으므로 아래 loadAll 은 폼을 덮어써도 된다.
      savedFormRef.current = { ...formRef.current, customTerms: filteredCustomTerms }
      formRef.current = savedFormRef.current
      setServerChangedWhileEditing(false)
      // 저장 후 다시 읽지 않으면 서명 전 점검이 저장 이전 상태로 남는다.
      // 이미 해결한 경고가 계속 보이는 것보다 위험한 방향이 있다 — 저장으로
      // 임금을 최저임금 미달로 낮춰도 낡은 점검이 "문제 없음"을 유지하고
      // 확인 체크박스가 아예 뜨지 않아, 안전망이 조용히 열린 채로 서명된다.
      await loadAll()
      toast.success(
        droppedCount > 0
          ? `저장되었습니다. (라벨/값이 비어있는 기타 항목 ${droppedCount}개는 저장되지 않았습니다.)`
          : '정상적으로 저장되었습니다.'
      )
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDraftDocument = async () => {
    setDrafting(true)
    try {
      await api.post(`/rooms/${roomId}/contract-draft`, form)
      // 본문이 바뀌면 서명 대상 문서가 바뀐 것이고, 서버의 문서 지문도 따라
      // 바뀐다. 화면이 들고 있는 옛 지문으로 서명하면 서버가 409로 막는다.
      // 본문만 갈아 끼우지 말고 지문과 점검 결과까지 함께 다시 읽는다.
      await loadAll()
      toast.success('AI 계약서 문장이 작성되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDrafting(false)
    }
  }

  const handleTranslate = async (language) => {
    setTranslating(true)
    try {
      await api.post(`/rooms/${roomId}/translate`, { language })
      await loadAll()
      toast.success('번역본이 준비되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setTranslating(false)
    }
  }

  const handleLinkPrevious = async (previousRoomId) => {
    setLinking(true)
    try {
      await api.post(`/rooms/${roomId}/link-previous`, { previousRoomId })
      await loadAll()
      toast.success('이전 계약과 연결되었습니다. 계속근로기간을 합산해 확인합니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLinking(false)
    }
  }

  const handleRecordEmploymentEnd = async ({ endedOn, reason }) => {
    setLinking(true)
    try {
      await api.post(`/rooms/${roomId}/employment-end`, { endedOn, reason })
      await loadAll()
      toast.success('근로관계 종료가 기록되었습니다. 보존 기간은 이 날부터 3년입니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLinking(false)
    }
  }

  const handleClearEmploymentEnd = async () => {
    if (!window.confirm('근로관계 종료 기록을 취소하면 다시 재직 중으로 표시되고 보존 의무가 계속됩니다. 진행할까요?')) {
      return
    }
    setLinking(true)
    try {
      await api.delete(`/rooms/${roomId}/employment-end`)
      await loadAll()
      toast.success('근로관계 종료 기록을 취소했습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLinking(false)
    }
  }

  const handleUnlinkPrevious = async () => {
    setLinking(true)
    try {
      await api.delete(`/rooms/${roomId}/link-previous`)
      await loadAll()
      toast.success('이전 계약 연결을 해제했습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLinking(false)
    }
  }

  const handleConfirmHire = async () => {
    if (!window.confirm('이 지원자의 채용을 확정하시겠습니까? 확정 후에는 양측이 서명할 수 있습니다.')) {
      return
    }
    setConfirmingHire(true)
    try {
      await api.post(`/rooms/${roomId}/confirm-hire`, {})
      await loadAll()
      toast.success('채용이 확정되었습니다. 이제 서명할 수 있습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setConfirmingHire(false)
    }
  }

  const handleCreateRequest = async ({ field, requestedValue, reason }) => {
    setRequestBusy(true)
    try {
      await api.post(`/rooms/${roomId}/change-requests`, { field, requestedValue, reason })
      await loadAll()
      toast.success('수정 요청을 보냈습니다. 회사 측 검토를 기다려주세요.')
      return true
    } catch (err) {
      toast.error(err.message)
      return false
    } finally {
      setRequestBusy(false)
    }
  }

  const handleRespondRequest = async (requestId, action) => {
    const note =
      action === 'decline' ? window.prompt('거절 사유를 입력해주세요. (선택)') ?? '' : ''
    setRequestBusy(true)
    try {
      await api.post(`/rooms/${roomId}/change-requests/${requestId}`, { action, note })
      await loadAll()
      toast.success(action === 'accept' ? '요청을 반영했습니다.' : '요청을 반려했습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRequestBusy(false)
    }
  }

  const handleSign = async (imageDataUrl) => {
    try {
      // 화면에서 확인 사항을 검토했다고 밝힌 사실을 서버에도 함께 보낸다.
      // 이전에는 이 체크가 화면에만 있어, 서버는 무엇을 확인했는지 알 수 없었다.
      await api.post(`/rooms/${roomId}/sign`, {
        imageDataUrl,
        acknowledgedIssues: acknowledged,
        // 화면이 보여 준 내용의 지문. 그동안 내용이 바뀌었으면 서버가 막는다.
        documentSha256,
        // 지문에 들어가지 않는 항목(임금 구성항목 등)의 변경까지 잡는다.
        termsUpdatedAt,
      })
      setSigningRole(null)
      await loadAll()
      toast.success('서명이 완료되었습니다.')
    } catch (err) {
      toast.error(err.message)
    }
  }

  // PDF 생성 라이브러리는 600KB가 넘는데, 계약서를 읽거나 서명만 하는 경우에는
  // 쓰이지 않는다. 그래서 페이지 진입 시가 아니라 실제로 내보내기를 누른 순간에
  // 불러온다.
  const buildPdf = async () => {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ])
    const canvas = await html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff' })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = pageWidth
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    let heightLeft = imgHeight
    let position = 0

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight

    while (heightLeft > 0) {
      position -= pageHeight
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }
    return pdf
  }

  // 보관·교부되는 문서는 저장된 조건이어야 한다.
  //
  // 인쇄 영역은 서버의 terms 가 아니라 화면의 입력값(form)을 그린다. 그리고
  // loadAll 은 저장하지 않은 입력을 일부러 지킨다 — 입력 중에 다른 버튼을
  // 눌렀다고 쓰던 내용이 사라지면 안 되니까. 그 둘이 겹치면, 저장한 적 없는
  // 금액이 찍힌 PDF 가 R2 에 보관되고 지원자에게 교부되며 그 SHA-256 이
  // '문서 무결성 지문'으로 표시된다. DB·수정 이력·감사추적·서명 지문은 전부
  // 다른 값인데, 종이로 남는 유일한 증거는 그쪽이다.
  const unsavedForPrint = () =>
    JSON.stringify(formRef.current) !== JSON.stringify(savedFormRef.current)

  const blockIfUnsaved = () => {
    if (!unsavedForPrint()) return false
    toast.error(
      '저장하지 않은 입력이 있습니다. 지금 만들면 저장된 계약 내용과 다른 문서가 남습니다. 저장하거나 입력을 되돌린 뒤 다시 시도해주세요.'
    )
    return true
  }

  const handleExportPdf = async () => {
    if (blockIfUnsaved()) return
    setExporting(true)
    try {
      const pdf = await buildPdf()
      pdf.save('근로계약서.pdf')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setExporting(false)
    }
  }

  const handleStoreAndSend = async () => {
    if (blockIfUnsaved()) return
    setStoring(true)
    try {
      const pdf = await buildPdf()
      const blob = pdf.output('blob')
      const fd = new FormData()
      fd.append('pdf', blob, '근로계약서.pdf')
      const data = await api.upload(`/rooms/${roomId}/signed-contract`, fd)
      setSignedContract(data.stored)
      setSignedMeta((m) => ({ ...m, emailConfigured: data.emailConfigured }))
      toast.success(
        data.stored?.emailStatus === 'sent'
          ? '계약서를 저장하고 이메일로 사본을 전송했습니다.'
          : '계약서가 저장되었습니다.'
      )
      // 이 요청은 저장만 하는 것이 아니다. 서버가 교부 이력을 남기고 감사추적에
      // '서명 계약서 보관'을 더한다. 다시 읽지 않으면 방금 일어난 교부가 화면에
      // 없는 것처럼 보인다. 저장은 이미 성공했으므로 재조회 실패로 성공 메시지가
      // 뒤집히지 않게 따로 감싼다.
      await loadAll().catch(() => {})
    } catch (err) {
      toast.error(err.message)
    } finally {
      setStoring(false)
    }
  }

  // 인쇄되는 계약서에 쓰는 값들.
  //
  // 표준근로계약서는 빈칸이 있는 양식이다. 값이 없으면 "-"를 넣는 대신 빈칸을
  // 그대로 두는 편이 원본에 가깝고, 무엇이 아직 안 정해졌는지도 눈에 띈다.
  const wageItemsForPrint = (form.wageItems ?? []).filter(
    (w) => w?.name && Number(w.amount) > 0
  )
  // 계약 체결일. 양측이 서명한 뒤에는 마지막 서명 시각이 곧 체결일이다.
  //
  // 서명이 몇 개인지 보지 않고 '가장 늦은 서명 시각'만 골라 쓰고 있었다.
  // 그래서 회사만 서명한 계약서에도 체결일이 찍혔다 — 근로자 서명란은 빈칸인
  // 채로. 계약이 언제 성립했는지를 다투기 위해 만든 서비스가, 아직 성립하지
  // 않은 계약에 성립일을 적어 내보내는 문서를 만든 것이다.
  const signedDateText = (() => {
    const at = (role) => signatures.find((x) => x.role === role)?.signedAt || null
    const company = at('company')
    const candidate = at('candidate')
    if (!company || !candidate) return '____년 __월 __일'
    const last = [company, candidate].sort().pop()
    const [y, m, d] = formatKst(last).slice(0, 10).split('-')
    return `${y}년 ${Number(m)}월 ${Number(d)}일`
  })()

  if (loading) return <p>불러오는 중...</p>
  if (error && !room) return <p className="error">{error}</p>

  return (
    <div className="contract-page">
      <header className="page-header">
        <Link to={`/rooms/${roomId}`} className="back-link">
          ← 면접방으로
        </Link>
        <h1>전자근로계약서</h1>
        <p>{room.title}</p>
        {/* 무엇이 왜 막혔는지 말하지 않으면 잠금은 고장으로 읽힌다. 버튼을
            눌러도 아무 일이 없는 화면에서 사람은 자기 잘못을 찾는다. */}
        {archived && (
          <p className="room-archived-note" role="status">
            보관된 면접방입니다. 계약 조건 수정, 채용 확정, 서명, 계약서 파일 저장, 번역, 수정 요청과
            그 응답, 이전 계약 연결, 근로관계 종료 기록이 모두 잠겨 있습니다. 내용을 보고 내려받는
            것은 그대로 됩니다.
          </p>
        )}
      </header>

      {!contractMeta.hireConfirmed && (
        <div className="notice hire-confirm-box">
          <p>
            아직 채용이 확정되지 않았습니다. 계약 조건은 지금 미리 작성할 수 있지만, 서명은 채용이 확정된
            후에 가능합니다.
          </p>
          {/* 잠긴 방에서 채용 확정을 권하고 있었다. 확정은 채용내정을
              성립시키는 행위인데, 그 방에서는 대화도 서명도 할 수 없다. */}
          {myRole === 'company' && !frozen && (
            <>
              <p className="hire-confirm-hint">
                면접방 대화에서 AI가 채용 확정을 인식하면 자동으로 확정됩니다. 면접을 별도로 진행했거나
                대화에 확정 표현이 없었다면 아래에서 직접 확정할 수 있습니다.
              </p>
              <button
                type="button"
                className="btn-primary"
                disabled={confirmingHire}
                onClick={handleConfirmHire}
              >
                {confirmingHire ? '처리 중...' : '채용 확정하기'}
              </button>
            </>
          )}
        </div>
      )}
      {isSigned && <p className="signed-banner">양측 서명이 완료되었습니다.</p>}

      <section className="contract-form">
        <h2>{myRole === 'company' ? '계약 조건 입력/수정' : '계약 조건 확인'}</h2>
        {myRole !== 'company' && !isSigned && (
          <p className="notice">계약 조건은 회사(고용) 측만 작성·수정할 수 있습니다. 내용을 확인한 뒤 서명해주세요.</p>
        )}
        {serverChangedWhileEditing && (
          <div className="form-conflict" role="status">
            <p>
              저장하지 않은 입력이 있어 화면을 그대로 두었습니다. 그 사이 계약 조건이 서버에서
              바뀌었습니다.
            </p>
            <button
              type="button"
              className="btn-sm"
              onClick={() => {
                setForm(savedFormRef.current)
                setServerChangedWhileEditing(false)
              }}
            >
              내 입력을 버리고 서버 값 불러오기
            </button>
          </div>
        )}

        <fieldset disabled={!canEdit}>
          <h3>당사자 정보</h3>
          {IDENTITY_FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <input value={form[f.key] ?? ''} onChange={(e) => updateField(f.key, e.target.value)} />
            </label>
          ))}

          <h3>근로조건</h3>
          {TERM_FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type={f.type ?? 'text'}
                placeholder={f.placeholder}
                value={form[f.key] ?? ''}
                onChange={(e) => updateField(f.key, e.target.value)}
              />
            </label>
          ))}

          <h3>사회보험 적용</h3>
          {SOCIAL_INSURANCE_FIELDS.map((f) => (
            <label key={f.key} className="checkbox-label">
              <input
                type="checkbox"
                checked={!!form.socialInsurance[f.key]}
                onChange={() => toggleInsurance(f.key)}
              />
              {f.label}
            </label>
          ))}

          <h3>그 밖의 사항</h3>
          {form.customTerms.map((c, idx) => (
            <div key={idx} className="custom-term-row">
              <input
                placeholder="항목명"
                aria-label={`${idx + 1}번 그 밖의 사항 항목명`}
                value={c.label}
                onChange={(e) => updateCustomTerm(idx, 'label', e.target.value)}
              />
              <input
                placeholder="내용"
                aria-label={`${idx + 1}번 그 밖의 사항 내용`}
                value={c.value}
                onChange={(e) => updateCustomTerm(idx, 'value', e.target.value)}
              />
              <button type="button" className="btn-danger btn-sm" onClick={() => removeCustomTerm(idx)}>
                삭제
              </button>
            </div>
          ))}
          <button type="button" onClick={addCustomTerm}>
            + 항목 추가
          </button>
        </fieldset>

        {/* 확정 뒤의 불리한 변경은 실질적으로 취소일 수 있다. 토스트는 사라지므로
            이 경고는 화면에 남긴다. */}
        {offerWarning && (
          <div className="offer-watch offer-watch-established" role="alert">
            <h3>{offerWarning.headline}</h3>
            <ul className="offer-signal-list">
              {offerWarning.changes.map((c) => (
                <li key={c.field}>
                  <span className="offer-signal-label">{c.label}</span>
                  {c.detail}
                </li>
              ))}
            </ul>
            <p>{offerWarning.detail}</p>
          </div>
        )}

        {canEdit && (
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
        )}
      </section>

      <WageComposition
        items={form.wageItems}
        composition={wageComposition}
        canEdit={canEdit}
        onChange={(items) => setForm((f) => ({ ...f, wageItems: items }))}
      />

      {canEdit && (user.isAdmin || user.isRecruiter) && (
        <section className="ai-draft">
          <h2>AI 계약서 문장 자동 작성</h2>
          <p>위에 입력한 조건을 바탕으로 표준근로계약서 형식의 계약서 문장을 AI가 작성합니다.</p>
          <button type="button" onClick={handleDraftDocument} disabled={drafting}>
            {drafting ? 'AI가 계약서를 작성하는 중...' : aiDocument ? 'AI 계약서 다시 작성하기' : 'AI로 계약서 작성하기'}
          </button>
        </section>
      )}

      {/* 근로자가 자기 계약을 이해하도록 돕는다. 서명 전에 보이는 것이 중요하므로
          서명 영역보다 위에 둔다. */}
      <ContractExplainer explanation={explanation} myRole={myRole} />

      <WorkerRights rights={workerRights} />

      {/* 공고를 보고 지원한 사람은 그 조건을 전제로 결정했다. 계약서에서 조건이
          나빠졌는지 값으로 대조해 알린다 (채용절차법 제4조 제3항). */}
      {postingComparison?.comparable && (
        <section className="posting-compare">
          <div className="period-head">
            <h2>공고와 대조</h2>
            <span
              className={`badge ${postingComparison.issues.length === 0 ? 'badge-success' : postingComparison.hasUnfavorable ? 'badge-danger' : 'badge-warning'}`}
            >
              {postingComparison.issues.length === 0
                ? '공고와 일치'
                : `다른 항목 ${postingComparison.issues.length}건`}
            </span>
          </div>
          <p className="period-detail">
            지원한 공고: {postingComparison.postingTitle}
          </p>
          <p className={postingComparison.issues.length === 0 ? 'period-detail' : 'period-alert'}>
            {postingComparison.summary}
          </p>
          {postingComparison.issues.length > 0 && (
            <ul className="compare-issue-list">
              {postingComparison.issues.map((i) => (
                <li key={i.field}>
                  <SeverityBadge severity={i.severity}>{i.label}</SeverityBadge>{' '}
                  {i.message}
                </li>
              ))}
            </ul>
          )}
          {postingComparison.matched.length > 0 && (
            <ul className="compare-issue-list matched">
              {postingComparison.matched.map((m) => (
                <li key={m.field}>
                  {m.label} — {m.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 교부 의무(근로기준법 제17조 제2항)는 사업주에게 있고 위반은 벌금
          대상이다. 이행 여부와 근로자가 실제로 확인했는지를 함께 보여 준다. */}
      {deliveryState && (
        <section className="contract-delivery">
          <div className="period-head">
            <h2>계약서 교부</h2>
            <span
              className={`badge ${deliveryState.viewed ? 'badge-success' : deliveryState.delivered ? 'badge-accent' : 'badge-warning'}`}
            >
              {deliveryState.label}
            </span>
          </div>
          <p className={deliveryState.delivered ? 'period-detail' : 'period-alert'}>
            {deliveryState.detail}
          </p>
          {deliveries.length > 0 && (
            <ul className="delivery-list">
              {deliveries.map((d) => (
                <li key={d.channel}>
                  <strong>{d.channelLabel}</strong> · {formatKst(d.deliveredAt)}
                  {d.status === 'failed' && <span className="compare-concern"> · 발송 실패</span>}
                  {d.firstViewedAt && ` · 열람 ${formatKst(d.firstViewedAt)}`}
                  {d.downloadedAt && ` · 내려받음 ${formatKst(d.downloadedAt)}`}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ContractPeriod period={period} />

      <ContractLifecycle
        continuity={continuity}
        retention={retention}
        linkableRooms={linkableRooms}
        canLink={myRole === 'company' && !isSigned && !frozen}
        onLink={handleLinkPrevious}
        onUnlink={handleUnlinkPrevious}
        busy={linking}
        employmentEnd={employmentEnd}
        canRecordEnd={myRole === 'company' && isSigned && !frozen}
        onRecordEnd={handleRecordEmploymentEnd}
        onClearEnd={handleClearEmploymentEnd}
      />

      <ContractTranslations
        translations={translations}
        sourceArticles={sourceArticles}
        languages={languages}
        canTranslate={myRole === 'company' && !frozen}
        onTranslate={handleTranslate}
        busy={translating}
      />

      {(myRole === 'company' || myRole === 'candidate') && (
        <ChangeRequests
          requests={changeRequests}
          myRole={myRole}
          canRequest={myRole === 'candidate' && !isSigned && !frozen}
          canRespond={!frozen}
          onCreate={handleCreateRequest}
          onRespond={handleRespondRequest}
          busy={requestBusy}
          prefill={requestPrefill}
        />
      )}

      <section className="signature-section">
        <h2>서명</h2>
        {/* 서명 후 내용이 바뀌면 그 서명은 바뀌기 전 내용에 대한 것이므로 무효다.
            왜 다시 서명해야 하는지 알 수 있게 사유와 시점을 함께 보여 준다. */}
        {revokedSignatures.length > 0 && (
          <div className="revoked-signatures" role="status">
            {/* 무효 기록이 하나라도 있으면 언제나 "다시 서명해주세요"를 띄웠다.
                체결이 끝난 계약에도, 본인이 다시 그린 것뿐이라 내용이 바뀐 적
                없는 경우에도 그랬다. 사실이 아닌 문장을 한 번 보여 주면 진짜
                경고도 같은 무게로 읽히지 않는다. */}
            <p className="period-alert">
              {isSigned
                ? '이 계약이 체결되기까지 무효화된 서명이 있습니다. 아래는 그 기록입니다.'
                : revokedSignatures.every((r) => r.reason === '본인이 다시 서명함')
                  ? '아래 서명은 본인이 다시 서명하면서 대체되었습니다. 계약 내용은 바뀌지 않았습니다.'
                  : '계약 내용이 변경되어 이전 서명이 무효화되었습니다. 내용을 다시 확인하고 서명해주세요.'}
            </p>
            <ul>
              {revokedSignatures.map((r, i) => (
                <li key={i}>
                  {r.role === 'company' ? '회사' : '지원자'} 서명 ({formatKst(r.signedAt)}) —{' '}
                  {r.reason} · {formatKst(r.revokedAt)} 무효화
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="signature-status-row">
          {[
            { role: 'company', label: '회사' },
            { role: 'candidate', label: '지원자' },
          ].map(({ role, label }) => {
            const sig = signatures.find((s) => s.role === role)
            return (
              <div key={role}>
                <p>{label}</p>
                {sig ? (
                  <>
                    <img src={sig.imageDataUrl} alt={`${label} 서명`} className="signature-thumb" />
                    {sig.environment && <p className="signature-evidence">{sig.environment}</p>}
                    {/* 이 서명이 어떤 내용에 붙었는지를 나타내는 지문.
                        지금 계약 내용과 같으면 그대로 유효하다는 뜻이다. */}
                    {sig.documentSha256 && (
                      <p className="signature-evidence">
                        문서 지문 {sig.documentSha256.slice(0, 12)}…
                        {documentSha256 && sig.documentSha256 !== documentSha256 && (
                          <span className="compare-concern"> · 현재 내용과 다름</span>
                        )}
                      </p>
                    )}
                  </>
                ) : (
                  <p>미서명</p>
                )}
              </div>
            )
          })}
        </div>
        {(myRole === 'company' || myRole === 'candidate') && !mySignature && (
          <>
            {preSign?.ready && (
              <PreSignCheck
                check={preSign}
                redrafting={drafting}
                onRedraft={
                  canEdit && (user.isAdmin || user.isRecruiter) ? handleDraftDocument : null
                }
                onRequestFix={
                  myRole === 'candidate'
                    ? (fix) => {
                        setRequestPrefill({ ...fix, at: Date.now() })
                        document
                          .querySelector('.change-requests')
                          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        toast.info('수정 요청 내용을 채워두었습니다. 확인 후 보내주세요.')
                      }
                    : null
                }
              />
            )}
            {preSign?.hasBlocking && (
              <label className="checkbox-label presign-ack">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                위 확인 사항을 모두 검토했으며, 이 내용으로 서명합니다.
              </label>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={() => setSigningRole(myRole)}
              disabled={
                frozen || !contractMeta.hireConfirmed || (preSign?.hasBlocking && !acknowledged)
              }
            >
              서명하기
            </button>
            {frozen && (
              <p className="notice">
                {archived ? '보관된 면접방입니다.' : '종료된 전형입니다.'} 서명은 잠겨 있습니다.
              </p>
            )}
            {!contractMeta.hireConfirmed && <p className="notice">채용이 확정된 후에 서명할 수 있습니다.</p>}
          </>
        )}
        {myRole === 'admin' && <p className="notice">관리자 열람 모드 — 서명은 참여자만 가능합니다.</p>}
        {mySignature && !otherSignature && <p>상대방의 서명을 기다리고 있습니다.</p>}
      </section>

      {isSigned && (
        <section className="signed-contract-section">
          <h2>서명 완료 계약서 보관 · 전송</h2>
          {signedContract ? (
            <>
              <p className="save-message">
                계약서가 저장되었습니다. ({formatKst(signedContract.createdAt)})
                {signedContract.emailStatus === 'sent' && ' · 이메일로 사본 전송 완료'}
                {signedContract.emailStatus === 'failed' && ' · 이메일 전송 실패'}
                {signedContract.emailStatus === 'not_sent' &&
                  !signedMeta.emailConfigured &&
                  ' · 이메일 미설정(저장만 완료)'}
              </p>
              <p>
                <a href={`/api/rooms/${roomId}/signed-contract-file`}>저장된 계약서 PDF 다운로드 →</a>
              </p>
              {signedContract.sha256Hash && (
                <p className="integrity-hash">
                  문서 무결성 지문(SHA-256): <code>{signedContract.sha256Hash}</code>
                  <br />
                  <em>
                    다운로드한 PDF의 SHA-256 해시가 위 값과 일치하면 저장 이후 위·변조되지 않았음이
                    증명됩니다.
                  </em>
                </p>
              )}
            </>
          ) : myRole === 'company' ? (
            <p className="notice">
              서명이 완료되었습니다. 아래 버튼을 누르면 계약서를 서버에 보관하고
              {signedMeta.candidateEmailMasked ? ` 지원자(${signedMeta.candidateEmailMasked})` : ' 지원자'}에게
              이메일로 전달합니다.
            </p>
          ) : (
            <p className="notice">회사 측에서 계약서를 저장·전송하면 여기에서 사본을 받을 수 있습니다.</p>
          )}

          {!signedMeta.emailConfigured && myRole === 'company' && (
            <p className="notice">
              이메일 발송 기능이 아직 설정되지 않았습니다. 지금은 서버 보관·다운로드만 가능합니다.
            </p>
          )}
          {myRole === 'company' && (
            <button
              type="button"
              className="btn-primary"
              onClick={handleStoreAndSend}
              disabled={storing || frozen}
            >
              {storing
                ? '처리 중...'
                : signedContract
                  ? '계약서 다시 저장·전송'
                  : '계약서 저장 및 지원자에게 이메일 전송'}
            </button>
          )}
        </section>
      )}

      {/* 계약 이력을 계약서에서 떼어낸 독립 문서. 계약 내용을 보이지 않고도
          체결 사실을 제3자에게 확인시키는 출구다. */}
      <AuditCertificate
        roomId={roomId}
        canIssue={Boolean(myRole)}
        hasSignature={signatures.length > 0}
        initial={certificates}
      />

      {history.length > 0 && (
        <section className="contract-history">
          <h2>수정 이력 ({historyTotal || history.length})</h2>
          {historyTotal > history.length && (
            <p className="notice">
              최근 {history.length}건만 표시합니다. 법령 점검과 증명서는 전체 {historyTotal}건을 모두
              반영합니다.
            </p>
          )}
          <ul className="history-list">
            {history.map((entry) => (
              <li key={entry.id} className="history-entry">
                <p className="history-meta">
                  {formatKst(entry.createdAt)} · {entry.editorName}
                  {entry.editorRole === 'company' ? ' (회사)' : entry.editorRole === 'candidate' ? ' (지원자)' : ''}
                </p>
                <ul className="history-changes">
                  {entry.changes.map((c, i) => (
                    <li key={i}>
                      <strong>{FIELD_LABELS[c.field] || c.field}</strong>: {formatHistoryValue(c.field, c.from)}
                      {' → '}
                      {formatHistoryValue(c.field, c.to)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button type="button" onClick={handleExportPdf} disabled={exporting}>
        {exporting ? 'PDF 생성 중...' : 'PDF 다운로드'}
      </button>

      {signingRole && (
        <SignatureModal
          signerLabel={signingRole === 'company' ? '회사' : '지원자'}
          onSave={handleSign}
          onClose={() => setSigningRole(null)}
        />
      )}

      <div className="contract-print" ref={printRef}>
        <h2 className="print-title">표준근로계약서</h2>

        {/* 고용노동부 표준근로계약서는 표가 아니라 번호가 붙은 조문이다.
            이것은 화면에 보여 주는 요약이 아니라 그대로 서명되고 교부되어
            보관되는 문서이므로, 실제 양식과 다른 모양이면 받는 사람이
            근로계약서로 알아보지 못한다. */}
        <p className="print-parties">
          <u>{form.employerName || ' '.repeat(14)}</u> (이하 "사업주"라 함)과(와){' '}
          <u>{form.employeeName || ' '.repeat(14)}</u> (이하 "근로자"라 함)은 다음과 같이
          근로계약을 체결한다.
        </p>

        {aiDocument ? (
          <div className="contract-articles">
            {aiDocument.map((article, idx) => (
              <div key={idx} className="contract-article">
                <h3>{article.heading}</h3>
                <p>{article.body}</p>
              </div>
            ))}
          </div>
        ) : (
          <ol className="print-clauses">
            <li>
              <span className="clause-name">근로계약기간</span>
              <span className="clause-value">
                {/* 종료일이 비어 있으면 기간의 정함이 없는 계약이다. 빈칸으로
                    찍으면 종료일만 안 채운 기간제 계약서처럼 보이고, 서명·보관
                    뒤에도 그 자리는 채워 넣을 수 있는 칸으로 남는다. 기간제냐
                    무기계약이냐는 갱신기대권과 이 앱이 지키려는 해고 보호에서
                    가장 큰 갈림이다. */}
                {form.contractStartDate || '____년 __월 __일'}부터{' '}
                {form.contractEndDate ? `${form.contractEndDate}까지` : '기간의 정함 없음'}
              </span>
              <span className="clause-note">
                ※ 근로계약기간을 정하지 않는 경우에는 "근로개시일"만 기재
              </span>
            </li>
            <li>
              <span className="clause-name">근 무 장 소</span>
              <span className="clause-value">{form.workLocation || ' '}</span>
            </li>
            <li>
              <span className="clause-name">업무의 내용</span>
              <span className="clause-value">{form.jobDescription || ' '}</span>
            </li>
            <li>
              <span className="clause-name">소정근로시간</span>
              <span className="clause-value">
                {/* 괄호 안이 상수로 박힌 빈칸이었다. 입력란도 저장할 칸도 없어
                    채울 방법 자체가 없었고, 서명·보관·교부되는 문서에 언제나
                    빈칸 하나가 남았다. 휴게시간은 제54조가 정하고 제17조가
                    명시를 요구하는 값이다. */}
                {form.workHoursStart || '__시 __분'}부터 {form.workHoursEnd || '__시 __분'}까지
                {' '}(휴게시간 : {form.breakTime || '__시 __분 ~ __시 __분'})
              </span>
            </li>
            <li>
              <span className="clause-name">근무일/휴일</span>
              <span className="clause-value">
                {/* 입력란의 이름은 '휴일'인데 여기서만 '주휴일'로 찍고 있었다.
                    토요일까지 유급 주휴일로 선언되면 제55조·제56조 제2항의
                    가산 대상이 달라진다. 저장된 값이 무엇인지 그대로 적는다. */}
                매주 {form.workDays || '__일'} 근무, 휴일 {form.restDays || '매주 __요일'}
              </span>
            </li>
            <li>
              <span className="clause-name">임 금</span>
              <ul className="clause-sub">
                {wageItemsForPrint.length > 0 ? (
                  wageItemsForPrint.map((w, i) => (
                    <li key={i}>
                      {w.name} : {Number(w.amount).toLocaleString('ko-KR')}원
                    </li>
                  ))
                ) : (
                  <li>
                    월(일, 시간)급 :{' '}
                    {form.wageBaseAmount
                      ? `${Number(form.wageBaseAmount).toLocaleString('ko-KR')}원`
                      : '__________원'}
                  </li>
                )}
                <li>
                  임금지급일 : {form.wagePayDate || '매월(매주 또는 매일) ____일'}
                  (휴일의 경우는 전일 지급)
                </li>
                <li>지급방법 : {form.wagePayMethod || '근로자에게 직접지급( ), 근로자 명의 예금통장에 입금( )'}</li>
              </ul>
            </li>
            <li>
              <span className="clause-name">연차유급휴가</span>
              <ul className="clause-sub">
                <li>{form.annualLeave || '연차유급휴가는 근로기준법에서 정하는 바에 따라 부여함'}</li>
              </ul>
            </li>
            <li>
              <span className="clause-name">사회보험 적용여부</span>
              <span className="clause-value">
                {SOCIAL_INSURANCE_FIELDS.map(
                  (f) => `${f.label} ( ${form.socialInsurance[f.key] ? '○' : '  '} )`
                ).join('  ')}
              </span>
            </li>
            <li>
              <span className="clause-name">근로계약서 교부</span>
              <ul className="clause-sub">
                <li>
                  사업주는 근로계약을 체결함과 동시에 본 계약서를 사본하여 근로자의 교부요구와
                  관계없이 근로자에게 교부함(근로기준법 제17조 이행)
                </li>
              </ul>
            </li>
            {form.customTerms.filter((c) => c.label && c.value).length > 0 && (
              <li>
                <span className="clause-name">그 밖의 사항</span>
                <ul className="clause-sub">
                  {form.customTerms
                    .filter((c) => c.label && c.value)
                    .map((c, i) => (
                      <li key={i}>
                        {c.label} : {c.value}
                      </li>
                    ))}
                </ul>
              </li>
            )}
            <li>
              <span className="clause-name">기 타</span>
              <ul className="clause-sub">
                <li>이 계약에 정함이 없는 사항은 근로기준법령에 의함</li>
              </ul>
            </li>
          </ol>
        )}

        <p className="print-date">{signedDateText}</p>

        {/* 표준근로계약서의 마지막은 좌우로 나눈 상자가 아니라, 사업주와
            근로자의 항목을 세로로 적고 그 옆에 서명하는 자리다. */}
        <div className="print-signatures">
          <dl className="print-party">
            <div>
              <dt>(사업주) 사업체명</dt>
              <dd>{form.employerName || ' '}</dd>
            </div>
            <div>
              <dt>주 소</dt>
              <dd>{form.employerAddress || ' '}</dd>
            </div>
            <div>
              <dt>대 표 자</dt>
              <dd className="print-sign-cell">
                {signatures.find((s) => s.role === 'company') ? (
                  <img
                    src={signatures.find((s) => s.role === 'company').imageDataUrl}
                    alt="사업주 서명"
                  />
                ) : (
                  <span className="print-sign-blank">(서명)</span>
                )}
              </dd>
            </div>
          </dl>

          <dl className="print-party">
            <div>
              <dt>(근로자) 주 소</dt>
              <dd>{form.employeeAddress || ' '}</dd>
            </div>
            <div>
              <dt>성 명</dt>
              <dd>{form.employeeName || ' '}</dd>
            </div>
            <div>
              <dt>서 명</dt>
              <dd className="print-sign-cell">
                {signatures.find((s) => s.role === 'candidate') ? (
                  <img
                    src={signatures.find((s) => s.role === 'candidate').imageDataUrl}
                    alt="근로자 서명"
                  />
                ) : (
                  <span className="print-sign-blank">(서명)</span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        {auditTrail && auditTrail.events.length > 0 && (
          <div className="audit-trail-print">
            <h3>계약 이력 증명 (감사추적)</h3>
            <table>
              <tbody>
                {auditTrail.events.map((e, i) => (
                  <tr key={i}>
                    <td className="audit-time">{e.at}</td>
                    <td>{e.event}</td>
                    <td>{e.detail || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {auditTrail.documentHash && (
              <p className="audit-hash">
                문서 무결성 지문(SHA-256): {auditTrail.documentHash}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
