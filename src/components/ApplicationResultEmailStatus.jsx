import { formatKst } from '../lib/formatTime.js'

const STATUSES = {
  pending: { label: '발송 대기', badge: 'badge-warning', message: '아직 발송을 시작하지 않았습니다.' },
  not_sent: { label: '미발송', badge: 'badge-warning', message: '이메일 발송 설정을 확인한 뒤 다시 보내주세요.' },
  sending: { label: '발송 처리 중', badge: 'badge-warning', message: '중복 발송을 막기 위해 다시 보내기는 잠겨 있습니다. 잠시 후 상태를 새로고침해주세요.' },
  sent: { label: '발송 완료 (Gmail 접수)', badge: 'badge-success', message: 'Gmail이 발송 요청을 접수했습니다. 수신함 도착이나 열람을 확인한 것은 아닙니다.' },
  failed: { label: '발송 실패', badge: 'badge-danger', message: '메일을 발송하지 못했습니다. 원인을 확인한 뒤 다시 보낼 수 있습니다.' },
  unknown: { label: '발송 결과 확인 필요', badge: 'badge-warning', message: '메일이 발송되었을 수 있어 다시 보내기를 차단했습니다. Gmail 보낸메일함을 확인해주세요.' },
  legacy_unknown: { label: '이전 발송 기록 확인 불가', badge: 'badge-neutral', message: '기존 처리 건으로 발송 기록을 확인할 수 없습니다. 미발송으로 단정할 수 없어 다시 보내기를 차단했습니다.' },
}

export default function ApplicationResultEmailStatus({ resultEmail, working, onRetry, onRefresh }) {
  const status = Object.hasOwn(STATUSES, resultEmail?.status) ? resultEmail.status : 'unknown'
  const display = STATUSES[status]
  // The backend owns retry eligibility. Keep a second, conservative UI guard
  // so an inconsistent response cannot offer a duplicate/uncertain send.
  const canRetry = resultEmail?.canRetry === true && ['pending', 'not_sent', 'failed'].includes(status)
  const sentAt = status === 'sent' ? formatKst(resultEmail?.sentAt) : ''
  const attemptedAt = formatKst(resultEmail?.attemptedAt)

  return (
    <section className="application-block" aria-label="서류 결과 안내 이메일" aria-busy={working || undefined}>
      <h3>서류 결과 안내 이메일</h3>
      <div role="status" aria-live="polite">
        <p><span className={`badge ${display.badge}`}>{display.label}</span></p>
        <p className="notice">{display.message}</p>
        {resultEmail?.message && status !== 'sent' && <p className="notice">{resultEmail.message}</p>}
        {sentAt && <p>Gmail 접수 시각: {sentAt} (한국 시간)</p>}
        {!sentAt && attemptedAt && <p>최근 발송 시도: {attemptedAt} (한국 시간)</p>}
      </div>
      <div className="modal-actions">
        {canRetry && (
          <button type="button" className="btn-secondary" disabled={working} onClick={onRetry}>
            {working ? '처리 중...' : '결과 안내 이메일 보내기'}
          </button>
        )}
        <button type="button" className="btn-ghost btn-sm" disabled={working} onClick={onRefresh}>
          발송 상태 새로고침
        </button>
      </div>
    </section>
  )
}
