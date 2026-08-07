import { TERM_FIELDS } from '../lib/contractTemplate.js'

export default function ContractFieldsForm({ terms, hireConfirmed, confirmationExcerpt }) {
  if (!terms) return <p>아직 분석된 채용 조건이 없습니다.</p>

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
          {TERM_FIELDS.map(({ key, label }) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              <td>{terms[key] ?? '-'}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">사회보험</th>
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
              <th scope="row">기타</th>
              <td>{terms.customTerms.map((c) => `${c.label}: ${c.value}`).join(', ')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
