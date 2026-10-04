import Fold from '../Fold.jsx'

const PERIOD_BADGE = {
  open_ended: 'badge-accent',
  scheduled: 'badge-neutral',
  active: 'badge-success',
  expiring_soon: 'badge-warning',
  expired: 'badge-danger',
  unknown: 'badge-neutral',
}

export default function ContractPeriod({ period }) {
  if (!period?.known) return null

  return (
    <Fold
      className="contract-period"
      title="계약 기간"
      badge={
        <span className={`badge ${PERIOD_BADGE[period.status] || 'badge-neutral'}`}>
          {period.label}
        </span>
      }
    >

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
    </Fold>
  )
}
