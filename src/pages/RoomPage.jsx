import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useChatPolling } from '../hooks/useChatPolling.js'
import { formatKstTime } from '../lib/formatTime.js'
import ChatMessageList from '../components/ChatMessageList.jsx'
import ChatComposer from '../components/ChatComposer.jsx'
import RoomDocuments from '../components/RoomDocuments.jsx'
import ContractFieldsForm from '../components/ContractFieldsForm.jsx'
import FinalOfferEmailForm from '../components/FinalOfferEmailForm.jsx'
import RoomInviteEmailForm from '../components/RoomInviteEmailForm.jsx'
import InterviewSummary from '../components/InterviewSummary.jsx'
import OfferWatch from '../components/OfferWatch.jsx'
import NegotiationLog from '../components/NegotiationLog.jsx'
import PreContractReview from '../components/PreContractReview.jsx'
import OfferWithdrawalModal from '../components/OfferWithdrawalModal.jsx'
import { roomStatusInfo } from '../lib/roomStatus.js'

// 전형을 왜 끝냈는지. 지원자에게는 사유마다 전혀 다른 의미다.
// (서버의 _lib/roomLifecycle.js와 같은 목록)
const CLOSE_REASONS = [
  { value: 'other_candidate', label: '다른 지원자를 채용했습니다' },
  { value: 'candidate_withdrew', label: '지원자가 전형을 그만두었습니다' },
  { value: 'position_cancelled', label: '채용 자체가 취소되었습니다' },
  { value: 'terms_not_agreed', label: '근로조건에 합의하지 못했습니다' },
  { value: 'other', label: '그 밖의 사유' },
]

// 닫을 수 있는 상태 (서버의 _lib/roomLifecycle.js와 같은 목록).
// 여기서 잘못 판단해도 서버가 409로 거절하므로, 화면은 안내만 맡는다.
const CLOSABLE_STATUSES = ['open', 'active', 'contract_pending']

export default function RoomPage() {
  const { roomId } = useParams()
  const toast = useToast()
  const { user } = useAuth()
  const [view, setView] = useState(null)
  const [error, setError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeReason, setCloseReason] = useState('other_candidate')
  const [closeNote, setCloseNote] = useState('')
  const [withdrawalOpen, setWithdrawalOpen] = useState(false)

  // 이 화면에 필요한 모든 정보를 한 번의 요청으로 받는다.
  const loadView = useCallback(async () => {
    const data = await api.get(`/rooms/${roomId}/view`)
    setView(data)
    return data
  }, [roomId])

  // 채용이 확정된 뒤의 종료는 전형 종료가 아니라 해고다.
  //
  // 확정된 방에서는 window.confirm 한 줄로 묻지 않는다. 그 창에는 근거 문장도,
  // 무슨 법이 걸리는지도, 지원자가 무엇을 할 수 있는지도 담기지 않아서
  // 담당자는 "예"를 누르고 지나간다. 사실을 앞에 놓는 창을 따로 띄운다.
  const requestClose = () => {
    if (view?.offer?.established) {
      setWithdrawalOpen(true)
      return
    }
    if (!window.confirm('이 전형을 종료하시겠습니까? 지원자에게 종료 사실과 사유가 안내됩니다.')) return
    void submitClose(false)
  }

  const submitClose = async (acknowledgedDismissal) => {
    setClosing(true)
    try {
      await api.post(`/rooms/${roomId}/close`, {
        reason: closeReason,
        note: closeNote,
        acknowledgedDismissal: acknowledgedDismissal ? true : undefined,
      })
      setWithdrawalOpen(false)
      await loadView()
      toast.success(
        acknowledgedDismissal
          ? '채용내정 취소로 기록했습니다.'
          : '전형을 종료했습니다. 지원자에게 안내되었습니다.'
      )
    } catch (err) {
      toast.error(err.message)
    } finally {
      setClosing(false)
    }
  }

  const handleReopen = async () => {
    setClosing(true)
    try {
      await api.delete(`/rooms/${roomId}/close`)
      await loadView()
      toast.success('전형을 다시 진행합니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setClosing(false)
    }
  }

  useEffect(() => {
    setView(null)
    setError('')
    loadView().catch((err) => setError(err.message))
  }, [loadView])

  // 대화의 첫 묶음은 위 요청에 이미 들어 있다. 그다음부터만 증분으로 확인한다.
  const {
    messages,
    // 훅이 내보내는 실패를 아무도 받지 않고 있었다. 세션이 끊기거나 서버가
    // 5xx 를 내면 2.5초마다 실패만 반복하고 대화는 그대로 멈추는데, 화면에는
    // 오류도 재시도 표시도 마지막 갱신 시각도 없었다. 그러면 '멈춘 것'과
    // '상대가 조용한 것'이 구별되지 않는다 — 지원자가 근로조건을 보내도
    // 담당자는 답이 없다고 판단하고 기다린다. 보내기는 오류를 보여 주는데
    // 받기만 완전히 침묵하는 비대칭이었다.
    error: chatError,
    lastSyncedAt,
    sendMessage: postMessage,
  } = useChatPolling(roomId, 2500, view?.messages ?? null)

  // 말하는 그 순간에 알려야 예방이다.
  //
  // 폴링은 메시지만 가져오고, 감시 배너와 협의 기록은 방에 들어올 때 한 번 받은
  // view 를 들고 있었다. 그래서 "다음 주부터 나오시죠"를 보내도 새로 고치기
  // 전까지 아무 경고도 뜨지 않았다 — 막아야 할 순간에 침묵한 셈이다.
  //
  // 서버가 방금 보낸 한 건을 훑어 신호를 함께 돌려주므로, 무언가 잡혔을 때만
  // 상태를 다시 불러온다. 아무 일도 없는 대화에서는 요청이 늘지 않는다.
  const sendMessage = useCallback(
    async (body) => {
      const sent = await postMessage(body)
      // 이미 확정으로 잡혀 있으면 같은 표현이 또 나와도 배너는 달라지지 않는다.
      // 조건이 오가는 대화에서 매 메시지마다 화면 전체를 다시 부르지 않도록,
      // 바뀔 수 있는 때만 다시 읽는다.
      const offerCouldChange =
        !view?.offer?.established &&
        ((sent?.offerSignal?.strong?.length ?? 0) > 0 ||
          (sent?.offerSignal?.weak?.length ?? 0) > 0)
      const termsRecorded = (sent?.negotiationAdded?.length ?? 0) > 0
      if (offerCouldChange || termsRecorded) await loadView().catch(() => {})
      return sent
    },
    [postMessage, loadView, view?.offer?.established]
  )

  const handleAnalyze = async () => {
    setAnalyzing(true)
    try {
      const data = await api.post(`/rooms/${roomId}/analyze`, {})
      setView((prev) => (prev ? { ...prev, contract: data } : prev))
      toast.success('채용 조건이 정리되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  if (error) return <p className="error">{error}</p>
  if (!view) return <p>불러오는 중...</p>

  const room = view.room
  const offer = view.offer
  const contract = view.contract
  const candidate = room.participants.find((participant) => participant.role === 'candidate')
  const company = room.participants.find((participant) => participant.role === 'company')

  return (
    <div className="room-page">
      <header className="page-header">
        <Link to="/dashboard" className="back-link">
          ← 대시보드
        </Link>
        <h1>{room.title}</h1>
        <p>참가자: {room.participants.map((p) => p.displayName).join(', ')}</p>
        {room.myRole === 'company' && <p>초대코드: {room.inviteCode}</p>}
        <span className={`badge ${roomStatusInfo(room.status).badgeClass}`}>
          {roomStatusInfo(room.status).label}
        </span>
      </header>

      {/* 끝난 전형이 "진행중"으로 남아 있으면 지원자는 계속 기다린다. */}
      {room.status === 'closed' && (
        <div className="room-closed" role="status">
          <p className="period-alert">
            이 전형은 종료되었습니다.{room.closeReason && ` 사유: ${room.closeReason}`}
          </p>
          <p className="period-detail">
            지금까지의 대화와 계약 조건은 그대로 볼 수 있습니다. 계약을 진행하는 작업만 막혀 있습니다.
          </p>
          {room.myRole === 'company' && (
            <button type="button" className="btn-sm" onClick={handleReopen} disabled={closing}>
              전형 다시 진행하기
            </button>
          )}
        </div>
      )}

      {/* 종료 기능은 서버에만 있고 화면에는 없었다. 부를 수 없는 기능은
          없는 기능이다. */}
      {room.myRole === 'company' && CLOSABLE_STATUSES.includes(room.status) && (
        <section className={`room-close${offer?.established ? ' room-close-dismissal' : ''}`}>
          <h2>{offer?.established ? '채용내정 취소' : '전형 종료'}</h2>

          {/* 이 서비스가 존재하는 이유가 이 경고다. 담당자는 자기가 이미 선을
              넘었다는 것을 모른 채 누른다. 누르고 나서 알려 주면 늦는다. */}
          {offer?.established && (
            <div className="dismissal-warning" role="alert">
              <p className="dismissal-headline">{offer.risk.headline}</p>
              <p className="period-detail">{offer.risk.reason}</p>
              {offer.excerpt ? (
                <blockquote className="dismissal-excerpt">
                  <span className="dismissal-excerpt-label">확정으로 본 근거</span>
                  {offer.excerpt}
                </blockquote>
              ) : (
                // 근거를 못 대면 담당자는 승복하지 않는다. 없으면 없다고 말한다 —
                // 있는 척하는 것보다 낫다.
                <p className="period-detail">
                  확정으로 기록되어 있으나 그렇게 본 근거 문장이 남아 있지 않습니다. 대화를 직접
                  확인한 뒤 판단해주세요.
                </p>
              )}
              <p className="period-detail">
                지원자가 취할 수 있는 조치: {offer.risk.remedies.join(' · ')}
              </p>
              {offer.risk.scopeNote && <p className="period-detail">{offer.risk.scopeNote}</p>}
              <details className="dismissal-grounds">
                <summary>취소가 인정될 수 있는 사유</summary>
                <ul>
                  {offer.risk.lawfulGrounds.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
                <p className="period-detail">
                  여기에 해당하지 않는다면 다른 정당한 이유를 갖춰야 합니다({offer.risk.law}).
                </p>
              </details>
            </div>
          )}

          {/* 아직 성립하지 않았어도 가까워졌으면 미리 말한다. 넘고 나서 아는
              것보다 넘기 전에 아는 편이 낫다. */}
          {!offer?.established && offer?.note && (
            <p className="period-alert" role="status">
              {offer.note}
            </p>
          )}

          <p className="period-detail">
            다른 사람을 채용했거나 채용 자체가 취소되었다면 여기서 전형을 끝냅니다. 끝내지 않으면
            지원자의 대시보드에는 계속 진행중으로 남아, 지원자는 기다립니다. 채용절차법 제10조는
            구직자에게 채용 여부를 알리도록 하고 있습니다.
          </p>
          <div className="career-row">
            <label>
              종료 사유
              <select value={closeReason} onChange={(e) => setCloseReason(e.target.value)}>
                {CLOSE_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              덧붙일 말 (선택)
              <input
                value={closeNote}
                onChange={(e) => setCloseNote(e.target.value)}
                maxLength={200}
                placeholder="지원자에게 사유와 함께 전달됩니다"
              />
            </label>
          </div>
          <p className="period-detail">
            지금까지의 대화와 계약 조건은 종료 뒤에도 그대로 볼 수 있습니다. 잘못 눌렀다면 다시
            진행할 수 있습니다.
          </p>
          <button
            type="button"
            className={offer?.established ? 'btn-danger btn-sm' : 'btn-sm'}
            onClick={requestClose}
            disabled={closing}
          >
            {closing
              ? '처리하는 중...'
              : offer?.established
                ? '채용내정 취소 진행'
                : '전형 종료하기'}
          </button>
        </section>
      )}

      {withdrawalOpen && (
        <OfferWithdrawalModal
          offer={offer}
          reasonLabel={CLOSE_REASONS.find((r) => r.value === closeReason)?.label}
          note={closeNote}
          busy={closing}
          onConfirm={() => submitClose(true)}
          onClose={() => setWithdrawalOpen(false)}
        />
      )}

      <RoomDocuments documents={view.documents} />

      {/* 막아야 할 순간은 취소할 때가 아니라 말할 때다. 대화 바로 위에 둔다. */}
      {room.myRole === 'company' && (
        <OfferWatch offer={offer} roomId={roomId} onChanged={loadView} />
      )}

      {room.myRole === 'company' && <NegotiationLog negotiation={view.negotiation} />}

      {/* 확정 뒤에 조건을 고치는 것이 실질적 취소다. 그 전에 본다. */}
      {room.myRole === 'company' && room.status !== 'signed' && (
        <PreContractReview roomId={roomId} />
      )}

      <div className="chat-panel">
        {chatError && (
          <p className="chat-offline" role="status">
            새 메시지를 받지 못하고 있습니다.
            {lastSyncedAt ? ` 마지막 확인 ${formatKstTime(lastSyncedAt)}.` : ''} 연결이 돌아오면
            자동으로 이어집니다 — 계속 이 표시가 남으면 화면을 새로 고쳐주세요.
          </p>
        )}
        <ChatMessageList messages={messages} participants={room.participants} />
        {room.myRole === 'admin' ? (
          <p className="notice">관리자 열람 모드입니다. 채팅 작성은 참여자만 가능합니다.</p>
        ) : (
          <ChatComposer onSend={sendMessage} />
        )}
      </div>

      <section className="ai-analysis">
        <h2>채용 조건 분석</h2>
        {/* 체결이 끝난 계약의 조건을 다시 정리하면 근로자가 보는 근로조건이
            바뀐다. 서버에서도 막지만 버튼부터 내린다. */}
        {room.myRole === 'company' && room.status !== 'signed' && (
          <button type="button" className="btn-primary" onClick={handleAnalyze} disabled={analyzing}>
            {analyzing ? '분석 중...' : 'AI로 조건 정리하기'}
          </button>
        )}
        {room.myRole === 'company' && room.status === 'signed' && (
          <p className="notice">
            서명이 완료된 계약이라 조건을 다시 정리할 수 없습니다. 변경이 필요하면 새 계약을
            체결해주세요.
          </p>
        )}
        <ContractFieldsForm
          terms={contract?.terms}
          hireConfirmed={contract?.hireConfirmed}
          confirmationExcerpt={contract?.confirmationExcerpt}
        />
        {contract?.terms?.analysisWarnings?.length > 0 && (
          <div className="ai-warnings">
            <h3>⚠️ AI 법적 검토 경고</h3>
            {contract.terms.analysisWarnings.map((w, i) => (
              <p key={i} className="error">
                {w}
              </p>
            ))}
          </div>
        )}
        <p>
          <Link to={`/rooms/${roomId}/contract`}>
            {room.myRole === 'company' ? '전자근로계약서 작성하러 가기 →' : '전자근로계약서 확인·서명하러 가기 →'}
          </Link>
        </p>
      </section>

      {room.myRole === 'company' && (
        <InterviewSummary
          roomId={roomId}
          record={view.interviewSummary}
          canWrite={!!(user?.isAdmin || user?.isRecruiter)}
          messageCount={messages.length}
          onChanged={loadView}
        />
      )}

      {room.myRole === 'company' && (
        <>
          <RoomInviteEmailForm
            roomId={roomId}
            initial={view.inviteEmail}
            candidateName={candidate?.displayName || '지원자'}
            companyName={company?.companyName || company?.displayName || '회사'}
          />
          <FinalOfferEmailForm
            roomId={roomId}
            initial={view.finalOfferEmail}
            candidateName={candidate?.displayName || '지원자'}
            companyName={company?.companyName || company?.displayName || '회사'}
          />
        </>
      )}
    </div>
  )
}
