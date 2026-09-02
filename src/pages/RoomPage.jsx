import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { useChatPolling } from '../hooks/useChatPolling.js'
import { formatKstTime } from '../lib/formatTime.js'
import ChatMessageList from '../components/ChatMessageList.jsx'
import ChatComposer from '../components/ChatComposer.jsx'
import MessageAlertToggle from '../components/MessageAlertToggle.jsx'
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
import { formatInviteCode } from '../lib/inviteCode.js'
import { alertNewMessages, alertsOn } from '../lib/desktopAlert.js'

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
  const [view, setView] = useState(null)
  const [error, setError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeReason, setCloseReason] = useState('other_candidate')
  const [closeNote, setCloseNote] = useState('')
  const [withdrawalOpen, setWithdrawalOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)
  // 확인 창을 종료와 보관이 함께 쓴다. 무엇을 하려던 것인지 기억하지 않으면
  // 보관을 눌렀는데 종료가 실행된다.
  const [withdrawalMode, setWithdrawalMode] = useState('close')

  // 보관 — 지금 상태 그대로 잠근다. 대화도 계약서도 손댈 수 없게 된다.
  //
  // 채용이 확정됐는데 아직 서명 전이면 서버가 409 로 되묻는다. 그때는 전형
  // 종료와 같은 확인 창을 띄운다 — 보관은 지원자가 받아야 할 계약서에 서명할
  // 길을 막는 일이라, 그 자리에서 무엇을 하는 것인지 알아야 한다.
  const handleArchive = async (acknowledged = false) => {
    if (
      !acknowledged &&
      !window.confirm(
        '이 면접방을 보관하시겠습니까?\n\n대화와 계약서 수정·서명·파일 저장이 잠깁니다. 지금까지의 기록은 그대로 볼 수 있고, 보관은 언제든 해제할 수 있습니다.'
      )
    ) {
      return
    }
    setArchiving(true)
    try {
      await api.post(`/rooms/${roomId}/archive`, acknowledged ? { acknowledgedDismissal: true } : {})
      // 보관은 이미 끝났다. 뒤이은 재조회가 실패했다고 보관이 실패한 것처럼
      // 말하면, 사용자는 다시 누르고 그때는 "이미 보관됨" 오류를 받는다.
      await loadView().catch(() => {})
      toast.success('면접방을 보관했습니다.')
      setWithdrawalOpen(false)
    } catch (err) {
      // 409 를 전부 "채용 확정이라 확인이 필요하다"로 읽고 있었다. 그래서
      // 이미 보관된 방을 한 번 더 보관하려 해도, 그 사이 상태가 바뀌었어도
      // "채용이 확정된 전형입니다"라는 가장 무거운 경고창이 떴다. 확정된 적
      // 없는 방에서도 똑같이 떴다. 사실이 아닌 자리에서 한 번 뜨면 진짜
      // 경고도 같은 무게로 읽히지 않는다.
      //
      // 서버는 확인이 필요할 때만 requiresAcknowledgement 를 함께 보낸다.
      if (err.data?.requiresAcknowledgement && !acknowledged) {
        // 창이 그리는 근거는 서버가 방금 준 것이어야 한다. 화면이 들고 있던
        // 옛 값으로 그리면 내용이 빈 경고가 된다.
        if (err.data.offer) setView((v) => (v ? { ...v, offer: err.data.offer } : v))
        setWithdrawalMode('archive')
        setWithdrawalOpen(true)
      } else {
        toast.error(err.message)
      }
    } finally {
      setArchiving(false)
    }
  }

  const handleUnarchive = async () => {
    setArchiving(true)
    try {
      await api.delete(`/rooms/${roomId}/archive`)
      await loadView().catch(() => {})
      toast.success('보관을 해제했습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setArchiving(false)
    }
  }

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
      setWithdrawalMode('close')
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
  } = useChatPolling(roomId, 2500, view?.messages ?? null, {
    // 내가 보낸 것이 되돌아온 것까지 알리면 내 말에 내가 알림을 받는다.
    viewerId: view?.room?.viewer?.id,
    // 알림을 켠 사람만, 탭이 가려져 있어도 느리게 계속 확인한다. 알림이
    // 필요한 순간이 바로 그때인데 원래는 그때 확인을 멈추고 있었다.
    pollWhenHidden: view?.room?.myRole === 'company' && alertsOn(),
    onIncoming: (fresh) =>
      alertNewMessages(fresh, {
        roomTitle: view?.room?.title,
        onClick: () => window.location.assign(`/rooms/${roomId}`),
      }),
  })

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

  if (error) return <p className="error" role="alert">{error}</p>
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
        {room.myRole === 'company' && room.inviteCode && (
          <p>면접방 입장 코드: {formatInviteCode(room.inviteCode)}</p>
        )}
        <span className={`badge ${roomStatusInfo(room.status).badgeClass}`}>
          {roomStatusInfo(room.status).label}
        </span>
      </header>

      {/* 보관은 잠금이다. 무엇이 잠겼는지 말하지 않으면, 대화창이 왜 사라졌는지
          모른 채 상대가 답을 안 한다고 생각하게 된다. */}
      {room.archivedAt && (
        <div className="room-archived" role="status">
          <p className="period-alert">이 면접방은 보관되었습니다.</p>
          <p className="period-detail">
            대화와 계약 조건 수정·서명·계약서 파일 저장이 잠겨 있습니다. 지금까지의 기록과 이미
            저장된 계약서는 그대로 보고 내려받을 수 있습니다.
            {room.archivedByName && ` (보관: ${room.archivedByName})`}
          </p>
          {room.myRole === 'company' && (
            <button type="button" className="btn-sm" onClick={handleUnarchive} disabled={archiving}>
              보관 해제하기
            </button>
          )}
        </div>
      )}

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
      {/* 보관된 방에서도 이 칸이 통째로 살아 있었다. 해고 확인 창을 띄우고
          체크박스를 켜고 마지막 버튼까지 누른 뒤에야 409 로 거절됐다 — 이
          앱에서 가장 무거운 절차를 끝까지 밟게 해 놓고 마지막에 막는 셈이다. */}
      {room.myRole === 'company' && !room.archivedAt && CLOSABLE_STATUSES.includes(room.status) && (
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
          mode={withdrawalMode}
          reasonLabel={CLOSE_REASONS.find((r) => r.value === closeReason)?.label}
          note={closeNote}
          busy={withdrawalMode === 'archive' ? archiving : closing}
          onConfirm={() =>
            withdrawalMode === 'archive' ? handleArchive(true) : submitClose(true)
          }
          onClose={() => setWithdrawalOpen(false)}
        />
      )}

      {/* 보관 — 더 일어날 일이 없을 때 지금 상태 그대로 잠근다.
          종료 칸과 나란히 두지 않는다. 둘은 다른 뜻이고, 나란히 있으면
          "끝내기 두 개" 로 읽혀 아무거나 누르게 된다. */}
      {room.myRole === 'company' && !room.archivedAt && (
        <section className="room-archive">
          <h2>면접방 보관</h2>
          <p>
            더 오갈 이야기가 없으면 지금 상태 그대로 잠급니다. 대화와 계약 조건 수정·서명·계약서
            파일 저장이 막히고, 지금까지의 기록과 이미 저장된 계약서는 그대로 볼 수 있습니다.
            보관은 언제든 해제할 수 있습니다.
          </p>
          <button type="button" onClick={() => handleArchive(false)} disabled={archiving}>
            {archiving ? '보관하는 중...' : '이 면접방 보관하기'}
          </button>
        </section>
      )}

      <RoomDocuments documents={view.documents} />

      {/* 막아야 할 순간은 취소할 때가 아니라 말할 때다. 대화 바로 위에 둔다. */}
      {room.myRole === 'company' && (
        <OfferWatch offer={offer} roomId={roomId} archived={!!room.archivedAt} onChanged={loadView} />
      )}

      {room.myRole === 'company' && <NegotiationLog negotiation={view.negotiation} />}

      {/* 확정 뒤에 조건을 고치는 것이 실질적 취소다. 그 전에 본다. */}
      {room.myRole === 'company' && !room.archivedAt && room.status !== 'signed' && (
        <PreContractReview roomId={roomId} />
      )}

      <div className="chat-panel">
        {/* 알림 스위치는 담당자에게만 보인다. 지원자는 코드로 한 번 들어왔다
            나가는 사람이라 브라우저 알림이 닿을 자리가 없고, 그 사람에게 가는
            알림은 메일이다 — 켜고 끌 것이 없다. */}
        {room.myRole === 'company' && !room.archivedAt && <MessageAlertToggle />}
        {chatError && (
          <p className="chat-offline" role="status">
            새 메시지를 받지 못하고 있습니다.
            {lastSyncedAt ? ` 마지막 확인 ${formatKstTime(lastSyncedAt)}.` : ''} 연결이 돌아오면
            자동으로 이어집니다 — 계속 이 표시가 남으면 화면을 새로 고쳐주세요.
          </p>
        )}
        <ChatMessageList
          messages={messages}
          participants={room.participants}
          viewerId={room.viewer?.id}
        />
        {room.archivedAt ? (
          <p className="notice">보관된 면접방입니다. 대화는 잠겨 있습니다.</p>
        ) : room.myRole === 'admin' ? (
          <p className="notice">관리자 열람 모드입니다. 채팅 작성은 참여자만 가능합니다.</p>
        ) : (
          <ChatComposer onSend={sendMessage} />
        )}
      </div>

      <section className="ai-analysis">
        <h2>채용 조건 분석</h2>
        {/* 체결이 끝난 계약의 조건을 다시 정리하면 근로자가 보는 근로조건이
            바뀐다. 서버에서도 막지만 버튼부터 내린다. 보관도 같다. */}
        {room.myRole === 'company' && !room.archivedAt && room.status !== 'signed' && (
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
          // 보관된 방에서는 서버가 409 로 막는다. 지난 요약을 읽는 것은 그대로
          // 두되, 새로 쓰는 버튼은 내린다.
          canWrite={!room.archivedAt && room.myRole === 'company'}
          messageCount={messages.length}
          onChanged={loadView}
        />
      )}

      {/* 보관된 방에서 최종합격·초대 이메일 폼이 그대로 살아 있었다. 다 쓰고
          보내야 409 가 돌아온다. 최종합격 통보는 채용내정을 성립시키는 행위인데
          정작 그 방에서는 답할 수도 없다. */}
      {room.myRole === 'company' && !room.archivedAt && (
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
