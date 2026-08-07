// 임금 구성항목 — 근로기준법 제17조가 요구하는 "임금의 구성항목".
//
// 임금을 기본급 한 칸으로 받으면 실제 계약서를 표현하지 못한다. 실제로는 그
// 밑에 식대·교통비·직책수당·고정연장수당이 붙고, 그중 무엇이 최저임금에
// 산입되는지가 갈린다(최저임금법 제6조 제4항).
//
// 그래서 이 화면의 핵심은 입력칸이 아니라 아래 두 숫자다. "월 지급액 합계"와
// "최저임금 산입 대상"이 나란히 보여야, 합계는 넉넉한데 실제로는 미달인 계약을
// 눈으로 알아볼 수 있다.

// 서버의 WAGE_ITEM_TYPES와 같은 목록. 산입 여부는 서버가 판정하므로 여기서는
// 고르는 데 필요한 것만 둔다.
const TYPES = [
  { value: 'base', label: '기본급', included: true },
  { value: 'fixed_allowance', label: '매월 고정수당', included: true },
  { value: 'monthly_bonus', label: '매월 지급 상여금', included: true },
  { value: 'welfare', label: '복리후생비(현금)', included: true },
  { value: 'overtime_fixed', label: '고정 연장·야간·휴일수당', included: false },
  { value: 'annual_leave_allowance', label: '연차수당', included: false },
  { value: 'irregular_bonus', label: '부정기 상여금', included: false },
  { value: 'in_kind', label: '현물 지급', included: false },
]

const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`

export default function WageComposition({ items, composition, canEdit, onChange }) {
  const rows = Array.isArray(items) ? items : []

  const update = (idx, field, value) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r))
    onChange(next)
  }
  const add = () => onChange([...rows, { name: '', type: rows.length === 0 ? 'base' : 'fixed_allowance', amount: '' }])
  const remove = (idx) => onChange(rows.filter((_, i) => i !== idx))

  // 입력도 없고 계산 결과도 없으면 그릴 것이 없다.
  if (!canEdit && !composition) return null

  return (
    <section className="wage-composition">
      <h2>임금 구성</h2>
      <p className="wage-note">
        근로기준법 제17조는 임금의 구성항목·계산방법·지급방법을 적도록 합니다. 항목을 나누면 그중 무엇이
        최저임금에 산입되는지까지 함께 계산합니다.
      </p>

      {canEdit && (
        <>
          <div className="wage-rows">
            {rows.map((row, idx) => {
              const type = TYPES.find((t) => t.value === row.type)
              return (
                <div className="wage-row" key={idx}>
                  <input
                    className="wage-name"
                    placeholder="항목명 (예: 식대)"
                    aria-label={`${idx + 1}번 임금 항목의 이름`}
                    value={row.name ?? ''}
                    maxLength={40}
                    onChange={(e) => update(idx, 'name', e.target.value)}
                  />
                  <select
                    value={row.type ?? ''}
                    aria-label={`${idx + 1}번 임금 항목의 종류`}
                    onChange={(e) => update(idx, 'type', e.target.value)}
                  >
                    {TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="wage-amount"
                    type="number"
                    min="0"
                    placeholder="금액"
                    aria-label={`${idx + 1}번 임금 항목의 금액 (원)`}
                    value={row.amount ?? ''}
                    onChange={(e) => update(idx, 'amount', e.target.value)}
                  />
                  <span className={`wage-included ${type?.included ? 'yes' : 'no'}`}>
                    {type?.included ? '산입' : '제외'}
                  </span>
                  <button type="button" className="btn-danger btn-sm" onClick={() => remove(idx)}>
                    삭제
                  </button>
                </div>
              )
            })}
          </div>
          <button type="button" onClick={add}>
            + 임금 항목 추가
          </button>
          {rows.length > 0 && !rows.some((r) => r.type === 'base') && (
            <p className="period-alert">기본급 항목이 있어야 저장할 수 있습니다.</p>
          )}
        </>
      )}

      {composition && (
        <>
          {!canEdit && (
            <ul className="wage-readonly">
              {composition.items.map((i, idx) => (
                <li key={idx}>
                  <span className="wage-readonly-name">{i.name}</span>
                  <span className="wage-readonly-type">{i.typeLabel}</span>
                  <span className="wage-readonly-amount">{won(i.amount)}</span>
                  <span className={`wage-included ${i.includedInMinimumWage ? 'yes' : 'no'}`}>
                    {i.includedInMinimumWage ? '산입' : '제외'}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* 이 두 숫자가 이 화면의 요점이다. */}
          <div className="wage-totals">
            <div>
              <span className="wage-total-label">월 지급액 합계</span>
              <strong>{won(composition.total)}</strong>
            </div>
            <div className={composition.hasExcluded ? 'wage-total-diff' : ''}>
              <span className="wage-total-label">최저임금 산입 대상</span>
              <strong>{won(composition.minimumWageBase)}</strong>
            </div>
          </div>
          <p className={composition.hasExcluded ? 'period-alert' : 'period-detail'}>{composition.detail}</p>
          {composition.hasExcluded && (
            <ul className="wage-excluded-notes">
              {composition.items
                .filter((i) => !i.includedInMinimumWage)
                .map((i, idx) => (
                  <li key={idx}>
                    <strong>{i.name}</strong> — {i.note}
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
