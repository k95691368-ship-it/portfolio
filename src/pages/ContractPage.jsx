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

const EMPTY_FORM = {
  employerName: '',
  employerAddress: '',
  employeeName: '',
  employeeAddress: '',
  contractStartDate: '',
  contractEndDate: '',
  workLocation: '',
  jobDescription: '',
  workHoursStart: '',
  workHoursEnd: '',
  workDays: '',
  restDays: '',
  wageBaseAmount: '',
  wagePayMethod: '',
  wagePayDate: '',
  annualLeave: '',
  uniformSize: '',
  socialInsurance: {},
  customTerms: [],
  wageItems: [],
}

// 지원 언어 (서버의 _lib/languages.js와 같은 목록)
const LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'zh', label: '중국어', nativeLabel: '中文' },
  { code: 'vi', label: '베트남어', nativeLabel: 'Tiếng Việt' },
  { code: 'th', label: '태국어', nativeLabel: 'ไทย' },
  { code: 'id', label: '인도네시아어', nativeLabel: 'Bahasa Indonesia' },
  { code: 'uz', label: '우즈베크어', nativeLabel: "O'zbekcha" },
  { code: 'ne', label: '네팔어', nativeLabel: 'नेपाली' },
  { code: 'km', label: '크메르어', nativeLabel: 'ភាសាខ្មែរ' },
  { code: 'my', label: '미얀마어', nativeLabel: 'မြန်မာဘာသာ' },
  { code: 'mn', label: '몽골어', nativeLabel: 'Монгол' },
]

// 외국인 근로자용 번역본 — 원본과 나란히 보여준다(공식 표준근로계약서 외국어본 방식).
function ContractTranslations({ translations, sourceArticles, canTranslate, onTranslate, busy }) {
  const [language, setLanguage] = useState('en')
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
            {LANGUAGES.map((l) => (
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
function ChangeRequests({ requests, myRole, canRequest, onCreate, onRespond, busy, prefill }) {
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
    await onCreate({ field, requestedValue: value, reason })
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
              {myRole === 'company' && (
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
  const [signatures, setSignatures] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
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
  const [sourceArticles, setSourceArticles] = useState([])
  const [translating, setTranslating] = useState(false)
  const [explanation, setExplanation] = useState(null)
  const [postingComparison, setPostingComparison] = useState(null)
  const [deliveries, setDeliveries] = useState([])
  const [deliveryState, setDeliveryState] = useState(null)
  const [documentSha256, setDocumentSha256] = useState(null)
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

    const t = contractData.terms || {}
    const company = roomData.participants.find((p) => p.role === 'company')
    const candidate = roomData.participants.find((p) => p.role === 'candidate')

    setForm({
      employerName: t.employerName ?? company?.companyName ?? company?.displayName ?? '',
      employerAddress: t.employerAddress ?? '',
      employeeName: t.employeeName ?? candidate?.displayName ?? '',
      employeeAddress: t.employeeAddress ?? '',
      contractStartDate: t.contractStartDate ?? '',
      contractEndDate: t.contractEndDate ?? '',
      workLocation: t.workLocation ?? '',
      jobDescription: t.jobDescription ?? '',
      workHoursStart: t.workHoursStart ?? '',
      workHoursEnd: t.workHoursEnd ?? '',
      workDays: t.workDays ?? '',
      restDays: t.restDays ?? '',
      wageBaseAmount: t.wageBaseAmount ?? '',
      wagePayMethod: t.wagePayMethod ?? '',
      wagePayDate: t.wagePayDate ?? '',
      annualLeave: t.annualLeave ?? '',
      uniformSize: t.uniformSize ?? '',
      socialInsurance: t.socialInsurance ?? {},
      customTerms: t.customTerms ?? [],
      wageItems: t.wageItems ?? [],
    })
    setEmploymentEnd({ endedAt: t.employmentEndedAt ?? null, reason: t.employmentEndReason ?? null })
    setSignatures(sigData.signatures)
    setChangeRequests(view.changeRequests ?? [])
    setPeriod(view.period ?? null)
    setExplanation(view.explanation ?? null)
    setPostingComparison(view.postingComparison ?? null)
    setDeliveries(view.deliveries ?? [])
    setDeliveryState(view.deliveryState ?? null)
    setDocumentSha256(view.documentSha256 ?? null)
    setRevokedSignatures(view.revokedSignatures ?? [])
    setCertificates(view.certificates ?? [])
    setWageComposition(view.wageComposition ?? null)
    setHistoryTotal(view.historyTotal ?? 0)
    setWorkerRights(view.workerRights ?? null)
    setContinuity(view.continuity ?? null)
    setRetention(view.retention ?? null)
    setLinkableRooms(view.linkableRooms ?? [])
    setTranslations(view.translations ?? [])
    setSourceArticles(view.sourceArticles ?? [])

    // 서명 전 최종 안전 점검은 아직 체결되지 않은 계약서에만 보여준다.
    setPreSign(roomData.status === 'signed' ? null : preSignData)

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
  const myRole = room?.myRole
  const otherRole = myRole === 'company' ? 'candidate' : 'company'
  const mySignature = signatures.find((s) => s.role === myRole)
  const otherSignature = signatures.find((s) => s.role === otherRole)
  const canEdit = !isSigned && myRole === 'company'

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
      await api.patch(`/rooms/${roomId}/contract`, payload)
      setForm((f) => ({ ...f, customTerms: filteredCustomTerms }))
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
    } catch (err) {
      toast.error(err.message)
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

  const handleExportPdf = async () => {
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
      </header>

      {!contractMeta.hireConfirmed && (
        <div className="notice hire-confirm-box">
          <p>
            아직 채용이 확정되지 않았습니다. 계약 조건은 지금 미리 작성할 수 있지만, 서명은 채용이 확정된
            후에 가능합니다.
          </p>
          {myRole === 'company' && (
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
        canLink={myRole === 'company' && !isSigned}
        onLink={handleLinkPrevious}
        onUnlink={handleUnlinkPrevious}
        busy={linking}
        employmentEnd={employmentEnd}
        canRecordEnd={myRole === 'company' && isSigned}
        onRecordEnd={handleRecordEmploymentEnd}
        onClearEnd={handleClearEmploymentEnd}
      />

      <ContractTranslations
        translations={translations}
        sourceArticles={sourceArticles}
        canTranslate={myRole === 'company'}
        onTranslate={handleTranslate}
        busy={translating}
      />

      {(myRole === 'company' || myRole === 'candidate') && (
        <ChangeRequests
          requests={changeRequests}
          myRole={myRole}
          canRequest={myRole === 'candidate' && !isSigned}
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
            <p className="period-alert">
              계약 내용이 변경되어 이전 서명이 무효화되었습니다. 내용을 다시 확인하고 서명해주세요.
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
              disabled={!contractMeta.hireConfirmed || (preSign?.hasBlocking && !acknowledged)}
            >
              서명하기
            </button>
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
            <button type="button" className="btn-primary" onClick={handleStoreAndSend} disabled={storing}>
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
        <p>
          {form.employerName || '사업체명 미기재'} (이하 "사업주")과(와) {form.employeeName || '근로자 미기재'}
          (이하 "근로자")은 다음과 같이 근로계약을 체결한다.
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
          <table>
            <tbody>
              {IDENTITY_FIELDS.map((f) => (
                <tr key={f.key}>
                  <th scope="row">{f.label}</th>
                  <td>{form[f.key] || '-'}</td>
                </tr>
              ))}
              {TERM_FIELDS.map((f) => (
                <tr key={f.key}>
                  <th scope="row">{f.label}</th>
                  <td>{form[f.key] || '-'}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">사회보험 적용</th>
                <td>
                  {SOCIAL_INSURANCE_FIELDS.filter((f) => form.socialInsurance[f.key])
                    .map((f) => f.label)
                    .join(', ') || '-'}
                </td>
              </tr>
              {form.customTerms.filter((c) => c.label && c.value).length > 0 && (
                <tr>
                  <th scope="row">그 밖의 사항</th>
                  <td>{form.customTerms.map((c) => `${c.label}: ${c.value}`).join(', ')}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        <div className="print-signatures">
          <div>
            <p>사업주 (회사)</p>
            {signatures.find((s) => s.role === 'company') && (
              <img src={signatures.find((s) => s.role === 'company').imageDataUrl} alt="회사 서명" />
            )}
          </div>
          <div>
            <p>근로자 (지원자)</p>
            {signatures.find((s) => s.role === 'candidate') && (
              <img src={signatures.find((s) => s.role === 'candidate').imageDataUrl} alt="지원자 서명" />
            )}
          </div>
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
