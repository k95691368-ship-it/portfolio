import { useState } from 'react'
import Modal from './Modal.jsx'

// 채용내정 취소 경고문.
//
// 예전에는 window.confirm 한 줄이었다. 그 창에는 근거 문장도, 무슨 법이
// 걸리는지도, 지원자가 무엇을 할 수 있는지도 담기지 않는다. 담당자는 "예"를
// 누르고 지나가고, 자기가 무엇을 한 것인지 나중에 안다.
//
// 이 창이 하는 일은 겁을 주는 것이 아니라 사실을 앞에 놓는 것이다 — 회사가
// 실제로 쓴 문장, 그 문장이 만든 법적 상태, 지금 누르면 벌어질 일, 그리고
// 취소가 인정될 수 있는 사유. 그것을 보고도 진행하겠다면 그건 판단이지 실수가
// 아니다.
export default function OfferWithdrawalModal({ offer, reasonLabel, note, onConfirm, onClose, busy }) {
  const [acknowledged, setAcknowledged] = useState(false)
  const risk = offer?.risk

  return (
    <Modal title="채용내정 취소 확인" onClose={onClose}>
      <h3 className="withdrawal-title">{risk?.headline}</h3>

      <p className="withdrawal-reason">{risk?.reason}</p>

      {offer?.excerpt ? (
        <blockquote className="offer-excerpt">
          <span className="offer-excerpt-label">확정으로 본 근거 — 회사가 보낸 문장</span>
          {offer.excerpt}
        </blockquote>
      ) : (
        <p className="period-detail">
          확정으로 기록되어 있으나 그렇게 본 근거 문장이 남아 있지 않습니다. 대화를 직접 확인한 뒤
          판단해주세요.
        </p>
      )}

      <dl className="withdrawal-facts">
        <dt>지금 누르면</dt>
        <dd>
          전형 종료가 아니라 해고로 기록되고, 지원자에게 종료 사실과 사유가 안내됩니다.
          {reasonLabel ? ` (사유: ${reasonLabel}${note ? ` · ${note}` : ''})` : ''}
        </dd>

        <dt>지원자가 취할 수 있는 조치</dt>
        <dd>{risk?.remedies?.join(' · ')}</dd>

        {risk?.scopeNote && (
          <>
            <dt>사업장 규모</dt>
            <dd>{risk.scopeNote}</dd>
          </>
        )}

        <dt>취소가 인정될 수 있는 사유</dt>
        <dd>
          <ul className="withdrawal-grounds">
            {(risk?.lawfulGrounds ?? []).map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          여기에 해당하지 않는다면 다른 정당한 이유를 갖춰야 합니다({risk?.law}).
        </dd>
      </dl>

      <label className="checkbox-label dismissal-ack">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          disabled={busy}
        />
        위 내용을 확인했으며, 이것이 해고로 다뤄질 수 있음을 알고 진행합니다.
      </label>

      <div className="modal-actions">
        <button type="button" onClick={onClose} disabled={busy}>
          그만두기
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={onConfirm}
          disabled={busy || !acknowledged}
        >
          {busy ? '처리하는 중...' : '해고로 기록하고 전형 종료'}
        </button>
      </div>
    </Modal>
  )
}
