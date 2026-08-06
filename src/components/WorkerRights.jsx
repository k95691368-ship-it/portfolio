// 근로자가 실제로 갖는 권리를 날짜와 금액으로 보여 준다.
//
// 계약서에는 "연차유급휴가: 근로기준법에 따름"이라고 적힌다. 틀린 말은 아니지만
// 근로자는 그 문장에서 아무것도 알 수 없다. 며칠이 언제 생기는지, 내가 퇴직금
// 대상인지, 연장근로 한 시간에 얼마를 받아야 하는지는 계약서에 적힌 값만으로
// 전부 계산되는데 아무도 계산해 주지 않았다.
const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`

export default function WorkerRights({ rights }) {
  if (!rights) return null
  const { annualLeave, severance, overtime } = rights
  if (!annualLeave?.known && !severance?.known && !overtime?.known) return null

  return (
    <section className="worker-rights">
      <h2>내 권리</h2>
      <p className="rights-note">
        계약서에 적힌 값으로 계산한 것입니다. 실제 출근일수와 계속근로 여부에 따라 달라질 수 있습니다.
      </p>

      {annualLeave?.known && (
        <div className="rights-block">
          <div className="rights-head">
            <h3>연차 유급휴가</h3>
            <span className="rights-law">{annualLeave.law ?? '근로기준법 제60조'}</span>
          </div>
          {annualLeave.applies === false ? (
            <p className="period-alert">{annualLeave.reason}</p>
          ) : (
            <>
              <p className="period-detail">{annualLeave.summary}</p>
              {annualLeave.upcoming && (
                <p className="rights-upcoming">
                  다음 발생: <strong>{annualLeave.upcoming.at}</strong>{' '}
                  {annualLeave.upcoming.days}일
                  {annualLeave.upcoming.cumulative && ` (누적 ${annualLeave.upcoming.cumulative}일)`}
                </p>
              )}
              <ul className="rights-years">
                {annualLeave.byYear.map((y) => (
                  <li key={y.serviceYears}>
                    <span>{y.at} · 근속 {y.serviceYears}년</span>
                    <strong>{y.days}일</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {severance?.known && (
        <div className="rights-block">
          <div className="rights-head">
            <h3>퇴직금</h3>
            <span className="rights-law">{severance.law}</span>
          </div>
          <p className={severance.eligible ? 'period-detail' : 'period-alert'}>{severance.reason}</p>
        </div>
      )}

      {overtime?.known && (
        <div className="rights-block">
          <div className="rights-head">
            <h3>연장·야간·휴일근로 수당</h3>
            <span className="rights-law">{overtime.law}</span>
          </div>
          <p className="period-detail">
            통상시급 <strong>{won(overtime.hourly)}</strong> (통상임금 {won(overtime.ordinaryMonthly)} ÷ 월
            소정근로 {overtime.monthlyHours}시간)
          </p>
          <ul className="rights-rates">
            {overtime.rates.map((r) => (
              <li key={r.name}>
                <span className="rights-rate-name">
                  {r.name}
                  {r.note && <em> {r.note}</em>}
                </span>
                <span className="rights-rate-mult">×{r.multiplier}</span>
                <strong>{won(r.perHour)}</strong>
              </li>
            ))}
          </ul>
          {overtime.caveat && <p className="rights-caveat">{overtime.caveat}</p>}
        </div>
      )}
    </section>
  )
}
