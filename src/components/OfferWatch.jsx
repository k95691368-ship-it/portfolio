import { useState } from 'react'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'

// 대화 감시 — 채용내정이 성립하는 순간을 그 자리에서 알린다.
//
// 이 서비스가 존재하는 이유는 회사가 자기가 언제 선을 넘었는지 모른 채
// 취소해서 손해배상을 무는 것을 막는 데 있다. 그런데 경고를 전형 종료 화면에만
// 두면, 담당자는 취소를 결심하고 그 화면에 들어온 뒤에야 처음 알게 된다.
// 그때는 이미 마음을 정한 뒤라 확인란에 체크하고 넘어간다.
//
// 막아야 할 순간은 취소할 때가 아니라 **말할 때**다. "다음 주부터 나오시죠"를
// 보내는 순간 계약이 서고, 그 사실을 그 자리에서 알면 담당자는 다르게 말한다.
//
// 회사 쪽에만 보인다. 지원자에게 "지금 내정이 성립했습니다"라고 알리는 것은
// 이 도구의 목적이 아니고, 회사가 아직 확정할 뜻이 없었다면 오히려 분쟁을
// 만든다.
export default function OfferWatch({ offer, roomId, archived = false, onChanged }) {
  const toast = useToast()
  const [saving, setSaving] = useState(false)

  if (!offer) return null
  if (!offer.established && !offer.likely) return null

  // 대화 표현만으로 잡은 것은 아직 기록이 아니다.
  //
  // 정규식이 조용히 법적 상태를 만들게 두지 않는다. 확정으로 기록하는 것은
  // 사람이 누르는 일이고, 이 화면은 그 판단에 필요한 것을 앞에 놓을 뿐이다.
  const phraseOnly = offer.established && offer.basis === 'phrase'

  const record = async () => {
    setSaving(true)
    try {
      await api.post(`/rooms/${roomId}/confirm-hire`, {})
      await onChanged?.()
      toast.success('채용 확정으로 기록했습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!offer.established) {
    return (
      <section className="offer-watch offer-watch-near" role="status">
        <h3>확정에 가까워지고 있습니다</h3>
        <p>{offer.note}</p>
        {offer.signals?.weak?.length > 0 && (
          <ul className="offer-signal-list">
            {offer.signals.weak.map((s, i) => (
              <li key={i}>
                <span className="offer-signal-label">{s.label}</span>
                {s.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <section className="offer-watch offer-watch-established" role="alert">
      <h3>{phraseOnly ? '이 대화로 채용내정이 성립했을 수 있습니다' : '채용이 확정된 전형입니다'}</h3>
      <p>{offer.risk?.reason}</p>

      {offer.excerpt && (
        <blockquote className="offer-excerpt">
          <span className="offer-excerpt-label">그렇게 본 근거</span>
          {offer.excerpt}
        </blockquote>
      )}

      <p className="offer-consequence">
        지금부터 전형을 끝내는 것은 채용 취소가 아니라 해고로 다뤄질 수 있습니다.
        {offer.risk?.remedies?.length > 0 && ` 지원자가 취할 수 있는 조치: ${offer.risk.remedies.join(' · ')}.`}
      </p>

      {/* 보관된 방에서는 확정 기록도 잠긴다(서버도 409). 버튼만 남겨 두면
          눌러 봐야 안 되는 화면이 된다. */}
      {phraseOnly && !archived && (
        <div className="offer-actions">
          <p className="offer-hint">
            실제로 채용을 확정했다면 기록으로 남겨 주세요. 확정 시각이 남아 있어야 나중에 어떤
            절차를 밟았는지 스스로 입증할 수 있습니다.
          </p>
          <button type="button" className="btn-sm" onClick={record} disabled={saving}>
            {saving ? '기록하는 중...' : '채용 확정으로 기록'}
          </button>
        </div>
      )}
    </section>
  )
}
