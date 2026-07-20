const LABELS = {
  workLocation: '근무장소',
  jobDescription: '업무의 내용',
  contractStartDate: '근로개시일',
  contractEndDate: '계약종료일',
  workHoursStart: '근무 시작 시각',
  workHoursEnd: '근무 종료 시각',
  workDays: '근무일',
  restDays: '휴일',
  wageBaseAmount: '기본급',
  wagePayMethod: '임금 지급 방법',
  wagePayDate: '임금 지급일',
  annualLeave: '연차유급휴가',
  uniformSize: '유니폼 사이즈',
}

export default function ContractFieldsForm({ terms, hireConfirmed, confirmationExcerpt }) {
  if (!terms) return <p>아직 분석된 조건이 없습니다. "AI로 조건 정리하기"를 눌러보세요.</p>

  return (
    <div className="contract-fields">
      {hireConfirmed && (
        <p className="hire-confirmed-banner">
          채용이 확정된 것으로 감지되었습니다.
          {confirmationExcerpt && <span> — "{confirmationExcerpt}"</span>}
        </p>
      )}
      <table>
        <tbody>
          {Object.entries(LABELS).map(([key, label]) => (
            <tr key={key}>
              <th>{label}</th>
              <td>{terms[key] ?? '-'}</td>
            </tr>
          ))}
          <tr>
            <th>사회보험</th>
            <td>
              {terms.socialInsurance
                ? Object.entries(terms.socialInsurance)
                    .filter(([, v]) => v)
                    .map(([k]) => k)
                    .join(', ') || '-'
                : '-'}
            </td>
          </tr>
          {terms.customTerms?.length > 0 && (
            <tr>
              <th>기타</th>
              <td>{terms.customTerms.map((c) => `${c.label}: ${c.value}`).join(', ')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
