import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useDm } from '../context/DmContext.jsx'
import { isDirectMessage, mergeDirectMessages } from '../lib/directMessages.js'

function shortTime(value) {
  if (!value) return ''
  const t = new Date(`${String(value).replace(' ', 'T')}Z`)
  if (Number.isNaN(t.getTime())) return ''
  return t.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })
}

function partnerLabel(p) {
  if (!p) return ''
  return p.companyName ? `${p.displayName} · ${p.companyName}` : p.displayName
}

// 열려 있는 한 사람과의 대화.
function DmWindow({ partner, onClose }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [loading, setLoading] = useState(true)
  const { refresh } = useDm()
  const bodyRef = useRef(null)
  const editVersion = useRef(0)
  const pending = useRef(null)
  const lifetime = useRef(null)

  useEffect(() => {
    const scope = {}
    lifetime.current = scope
    return () => { if (lifetime.current === scope) lifetime.current = null }
  }, [])

  useEffect(() => {
    let alive = true
    let reading = false
    const load = async () => {
      if (!alive || reading) return
      reading = true
      try {
        const data = await api.get(`/dm/${partner.id}`)
        if (!alive) return
        if (!Array.isArray(data?.messages) || !data.messages.every(isDirectMessage)) {
          throw new Error('쪽지 목록을 확인하지 못했습니다.')
        }
        setMessages(previous => mergeDirectMessages(previous, data.messages))
        setReadError('')
      } catch (err) {
        if (alive) setReadError(err.message || '쪽지 목록을 확인하지 못했습니다.')
      } finally {
        reading = false
        if (alive) setLoading(false)
      }
    }
    load()
    // 창이 열려 있는 동안에는 자주 본다. 대화 중에 20초를 기다리게 하면
    // 상대가 답을 했는지 알 수 없어 같은 말을 두 번 보내게 된다.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 7000)
    return () => {
      alive = false
      clearInterval(timer)
      // 창을 닫으면 배지가 줄어야 한다. 읽음 처리는 위 GET 이 이미 했다.
      refresh()
    }
  }, [partner.id, refresh])

  // 새 줄이 오면 맨 아래로. 위로 올려 지난 대화를 보고 있을 때는 끌어내리지
  // 않는다 -- 읽던 자리를 빼앗기는 것이 놓친 한 줄보다 답답하다.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = async (e) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || pending.current || !lifetime.current) return
    const request = { version: editVersion.current, scope: lifetime.current }
    pending.current = request
    const isCurrent = () => pending.current === request && lifetime.current === request.scope
    setBusy(true)
    setError('')
    try {
      const data = await api.post(`/dm/${partner.id}`, { body: text })
      if (!isCurrent()) return
      if (!isDirectMessage(data?.message)) throw new Error('쪽지 전송 결과를 확인하지 못했습니다.')
      setMessages(previous => mergeDirectMessages(previous, [data.message]))
      if (editVersion.current === request.version) setDraft('')
      const el = bodyRef.current
      if (el) requestAnimationFrame(() => {
        if (lifetime.current === request.scope && bodyRef.current === el) el.scrollTop = el.scrollHeight
      })
    } catch (err) {
      if (isCurrent()) setError(err.message || '쪽지 전송을 확인하지 못했습니다.')
    } finally {
      if (isCurrent()) setBusy(false)
      if (pending.current === request) pending.current = null
    }
  }

  return (
    <section className="dm-window" aria-label={`${partner.displayName}님과의 쪽지`}>
      <header className="dm-window-head">
        <span className="dm-window-title">{partnerLabel(partner)}</span>
        <button type="button" className="dm-icon-btn" onClick={onClose} aria-label="쪽지창 닫기">
          ✕
        </button>
      </header>
      <div
        className="dm-window-body"
        ref={bodyRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {loading && <p className="dm-hint">불러오는 중...</p>}
        {!loading && messages.length === 0 && !readError && (
          <p className="dm-hint">아직 주고받은 쪽지가 없습니다.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`dm-bubble-row${m.fromMe ? ' mine' : ''}`}>
            <div className="dm-bubble">{m.body}</div>
            <span className="dm-bubble-time">
              {m.fromMe && m.readAt ? '읽음 · ' : ''}
              {shortTime(m.createdAt)}
            </span>
          </div>
        ))}
      </div>
      {readError && <p className="dm-error" role="alert">{readError} 잠시 후 자동으로 다시 조회합니다.</p>}
      {error && <p className="dm-error" role="alert">{error}</p>}
      <form className="dm-compose" onSubmit={send}>
        <label className="sr-only" htmlFor="dm-draft">쪽지 내용</label>
        <textarea
          id="dm-draft"
          value={draft}
          onChange={(e) => { editVersion.current++; setDraft(e.target.value) }}
          onKeyDown={(e) => {
            // 엔터로 보내되 줄바꿈은 남긴다.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send(e)
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder="쪽지를 입력하세요"
        />
        <button type="submit" className="btn-primary btn-sm" disabled={busy || !draft.trim()}>
          {busy ? '보내는 중' : '보내기'}
        </button>
      </form>
    </section>
  )
}

// 오른쪽 아래에 떠 있는 도구 모음.
//
// 쪽지함과 화면 색 버튼이 함께 산다. 화면 색 버튼은 머리말에 있었는데, 거기는
// 표지와 관리자 문이 서는 자리라 성격이 다른 것이 섞여 있었다. 이제 둘 다
// 오른쪽 아래 한 자리에 모인다.
//
// 화면 색 버튼은 로그인하지 않아도 있어야 하므로, 쪽지함이 비어 있어도 이
// 칸 자체는 그린다. 그리고 쪽지 버튼 바로 위에 붙인다 -- 대화창 위에 두면
// 창을 열 때마다 버튼이 위로 밀려 자리가 바뀐다.
export default function DmDock() {
  const { user } = useAuth()
  const { threads, unreadTotal, inboxError, inboxLoading, inboxLoaded, refresh, open, listOpen, alerts, openDm, closeDm, toggleList, dismissAlert } =
    useDm()

  // 알림은 잠깐 떴다 스스로 사라진다. 쌓이면 화면 오른쪽을 통째로 덮는다.
  useEffect(() => {
    if (alerts.length === 0) return undefined
    const timers = alerts.map((a) => setTimeout(() => dismissAlert(a.key), 8000))
    return () => timers.forEach(clearTimeout)
  }, [alerts, dismissAlert])

  return (
    <div className="dm-dock">
      {user && (
      <div className="dm-alerts" role="status" aria-live="polite">
        {alerts.map((a) => (
          <button
            key={a.key}
            type="button"
            className="dm-alert"
            onClick={() => openDm(a.partner)}
          >
            {/* 이름과 조사를 한 덩이로 묶는다. 풀어 두면 <strong> 이 자체로
                한 칸을 차지해 flex 간격이 그 사이에 들어가고, "박서준 님이"
                처럼 이름과 조사가 벌어진다. */}
            <span className="dm-alert-text">
              <strong>{a.partner.displayName}</strong>님이 쪽지를 보냈습니다.
            </span>
            <span className="dm-alert-cta">열기</span>
          </button>
        ))}
      </div>
      )}

      {user && open && <DmWindow key={open.id} partner={open} onClose={closeDm} />}

      {user && listOpen && !open && (
        <section className="dm-window dm-list-window" aria-label="쪽지함">
          <header className="dm-window-head">
            <span className="dm-window-title">쪽지함</span>
            <button type="button" className="dm-icon-btn" onClick={toggleList} aria-label="쪽지함 닫기">
              ✕
            </button>
          </header>
          <div className="dm-window-body">
            {inboxError && <div className="dm-inbox-feedback">
              <p className="dm-error" role="alert">{inboxError}</p>
              <button type="button" className="btn-ghost btn-sm" disabled={inboxLoading} onClick={refresh} aria-label="쪽지함 다시 불러오기">
                {inboxLoading ? '불러오는 중…' : '다시 불러오기'}
              </button>
            </div>}
            {!inboxLoaded && inboxLoading && <p className="dm-hint" role="status">쪽지함을 불러오는 중…</p>}
            {inboxLoaded && !inboxError && threads.length === 0 ? (
              <p className="dm-hint">
                주고받은 쪽지가 없습니다. 관리자 패널의 이름을 누르면 쪽지를 보낼 수 있습니다.
              </p>
            ) : threads.length > 0 && (
              <ul className="dm-thread-list">
                {threads.map((t) => (
                  <li key={t.partner.id}>
                    <button type="button" className="dm-thread" onClick={() => openDm(t.partner)}>
                      <span className="dm-thread-top">
                        <span className="dm-thread-name">{partnerLabel(t.partner)}</span>
                        <span className="dm-thread-time">{shortTime(t.lastAt)}</span>
                      </span>
                      <span className="dm-thread-last">
                        {t.lastFromMe ? '나: ' : ''}
                        {t.lastBody}
                      </span>
                      {t.unread > 0 && <span className="dm-thread-badge">{t.unread}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {user && (
      <button
        type="button"
        className="dm-launcher"
        onClick={open ? closeDm : toggleList}
        aria-label={inboxError ? '쪽지함 조회 실패' : unreadTotal > 0 ? `쪽지함, 안 읽음 ${unreadTotal}개` : '쪽지함'}
        aria-expanded={listOpen || !!open}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path d="M5.5 18.5 4 21l3.5-1.25A9 9 0 1 0 5.5 18.5Z" />
        </svg>
        <span className="dm-launcher-text">쪽지</span>
        {unreadTotal > 0 && (
          <span className="dm-launcher-badge" aria-hidden="true">
            {unreadTotal > 9 ? '9+' : unreadTotal}
          </span>
        )}
        {inboxError && unreadTotal === 0 && <span className="dm-launcher-badge" aria-hidden="true">!</span>}
      </button>
      )}
    </div>
  )
}
