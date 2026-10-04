import SeverityBadge from '../SeverityBadge.jsx'

// 서명 전 자동 점검 — 기록된 값·이력·본문 표현의 일부만 대조한다.
export default function PreSignCheck({ check, onRequestFix, onRedraft, redrafting }) {
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
      <p className="period-detail">
        점검은 기록된 변경 이력과 입력 조건, 일부 본문 표현을 기준으로 합니다. 전체 합의나 계약의
        법적 유효성을 보증하지 않습니다. 서명 전에 대화에서 합의한 내용과 계약서 전체를 직접 대조해주세요.
      </p>

      {clean && (
        <p className="presign-ok">
          ✓ 자동 점검 대상 항목에서 차이·누락·경고가 발견되지 않았습니다.
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
