import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'

// 평가자용 체험. 머리말 오른쪽의 버튼 하나로 접어 둔다.
//
// 이 서비스가 하는 일의 대부분은 로그인 뒤에 있다. 처음 온 사람이 계정을
// 만들고 상대 역할까지 준비해서 서명까지 가야만 핵심이 보인다면, 그건 아무도
// 보지 않는 기능과 같다. 이미 진행된 계약을 심어 두고 그 문을 열어 준다.
//
// 첫 화면 한가운데를 차지하고 있던 것을 여기로 옮겼다. 안내는 길수록 안 읽히고,
// 정작 눌러야 할 두 갈래(회사·지원자)를 아래로 밀어냈다. 접어 두면 화면은
// 조용해지고, 필요한 사람은 언제든 편다.
//
// 마우스를 올리면 펴지되 그것만으로 열지는 않는다. 손으로 만지는 화면에는
// 올리는 동작이 없고, 키보드로 다니는 사람에게도 없다. 눌러도 열리고 초점이
// 들어와도 열린다 -- 셋 중 하나만 두면 나머지 사람은 이 문을 못 연다.
//
// 데모가 심어져 있지 않으면 아무것도 그리지 않는다. 없는 계정을 안내하는 것이
// 안내가 없는 것보다 나쁘다.

// 마우스가 버튼과 펼친 칸 사이를 지날 때 닫히지 않게 하는 여유.
const CLOSE_DELAY_MS = 200

export default function DemoMenu() {
  const [demo, setDemo] = useState(null)
  const [open, setOpen] = useState(false)
  const [steps, setSteps] = useState(false)
  const [starting, setStarting] = useState(null)
  // 계정과 비밀번호는 평소에 접어 둔다. 버튼으로 들어갈 수 있게 된 뒤로
  // 직접 입력해 보려는 사람만 필요한 값이다.
  const [showKeys, setShowKeys] = useState(false)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const closeTimer = useRef(null)
  const navigate = useNavigate()
  const toast = useToast()
  const { user, startDemo } = useAuth()

  useEffect(() => {
    api
      .get('/demo')
      .then((d) => setDemo(d.seeded ? d : null))
      .catch(() => setDemo(null))
  }, [])

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }, [cancelClose])

  useEffect(() => () => cancelClose(), [cancelClose])

  // 바깥을 누르거나 Esc 를 누르면 닫는다. Esc 로 닫을 때는 초점을 버튼으로
  // 되돌린다 -- 그러지 않으면 키보드로 다니는 사람의 초점이 사라진 칸에 남는다.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!demo) return null

  // 실제 계정으로 로그인한 사람에게는 보이지 않는다.
  //
  // 이 버튼은 지금 세션을 체험 계정으로 바꾼다. 첫 화면에만 있을 때는 로그인한
  // 사람이 마주칠 일이 거의 없었지만, 머리말로 올라오면 모든 화면에 따라다닌다.
  // 자기 계정으로 일하던 사람이 눌러 로그아웃되는 일은 없어야 한다.
  // 체험 계정으로 들어와 있는 동안에는 그대로 둔다 -- 회사와 지원자를 오가며
  // 보는 것이 이 체험의 핵심이기 때문이다.
  const inDemo = !!user && String(user.email || '').endsWith('@demo.invalid')
  if (user && !inDemo) return null

  // 어느 쪽으로 들어갈지만 보낸다. 이메일은 서버가 코드에 박힌 목록에서
  // 고른다 -- 화면이 보낸 주소로 로그인시키면 그 문은 남의 계정도 연다.
  const begin = async (role, to) => {
    setStarting(role)
    try {
      const started = await startDemo(role)
      toast.success(`${started.displayName}님으로 체험을 시작합니다.`)
      setOpen(false)
      navigate(to)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setStarting(null)
    }
  }

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label}을(를) 복사했습니다.`)
    } catch {
      toast.error('복사할 수 없습니다. 직접 선택해 복사해주세요.')
    }
  }

  return (
    <div
      className="demo-menu"
      ref={rootRef}
      onMouseEnter={() => {
        cancelClose()
        setOpen(true)
      }}
      onMouseLeave={scheduleClose}
      onFocus={() => {
        cancelClose()
        setOpen(true)
      }}
      onBlur={(e) => {
        // 초점이 이 칸 안의 다른 곳으로 옮겨 간 것은 나간 것이 아니다.
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <button
        type="button"
        className="demo-menu-trigger"
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        1시간 체험
        <span className={`demo-menu-caret${open ? ' open' : ''}`} aria-hidden="true">
          ⌄
        </span>
      </button>

      {open && (
        <div className="demo-menu-panel">
          <div className="demo-menu-head">
            <span className="badge badge-accent">채용 담당자용</span>
            <strong>1시간 체험</strong>
          </div>
          {/* 짧게 줄이되 "시연용 예시"는 남긴다. 실제 계약처럼 보이는 화면을
              띄워 놓고 그것이 예시라는 말을 빼면, 줄인 것이 아니라 속이는 것이 된다. */}
          <p className="demo-menu-lead">
            계약 체결까지 진행된 상태에서 시작합니다. 데이터는 시연용 예시입니다.
          </p>

          {/* 계정과 비밀번호를 적어 두어도 대부분은 옮겨 적지 않고 그만둔다.
              누르면 그 자리에서 로그인되어 바로 들어가게 한다. */}
          <div className="demo-menu-start">
            <button
              type="button"
              className="btn-primary"
              disabled={!!starting}
              onClick={() => begin('company', '/dashboard')}
            >
              {starting === 'company' ? '들어가는 중...' : '회사로 체험 시작'}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!!starting}
              onClick={() => begin('candidate', '/dashboard')}
            >
              {starting === 'candidate' ? '들어가는 중...' : '지원자로 체험 시작'}
            </button>
          </div>
          <p className="demo-menu-note">창을 닫으면 체험 로그인은 끝납니다.</p>

          <button
            type="button"
            className="demo-menu-toggle"
            onClick={() => setShowKeys((v) => !v)}
            aria-expanded={showKeys}
          >
            {showKeys ? '계정 정보 접기' : '직접 로그인할 계정 보기'}
          </button>
          {showKeys && (
            <div className="demo-credentials">
              {demo.accounts.map((a) => (
                <div className="demo-credential" key={a.email}>
                  <span className="demo-role">{a.role === 'company' ? '회사' : '지원자'}</span>
                  <code>{a.email}</code>
                  <button type="button" className="btn-sm" onClick={() => copy(a.email, '아이디')}>
                    복사
                  </button>
                </div>
              ))}
              <div className="demo-credential">
                <span className="demo-role">비밀번호</span>
                <code>{demo.password}</code>
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() => copy(demo.password, '비밀번호')}
                >
                  복사
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            className="demo-menu-toggle"
            onClick={() => setSteps((v) => !v)}
            aria-expanded={steps}
          >
            {steps ? '순서 접기' : '무엇을 보게 되나요?'}
          </button>
          {steps && (
            <ol className="demo-steps">
              {(demo.walkthrough ?? []).map((s) => (
                <li key={s.step}>
                  <strong>{s.title}</strong>
                  <p>{s.body}</p>
                </li>
              ))}
              {demo.certificateSerial && (
                <li>
                  <strong>바로 확인해 보기</strong>
                  <p>
                    이미 발급된 증명서가 있습니다. 발급번호 <code>{demo.certificateSerial}</code> 를
                    확인 화면에 넣어 보세요.{' '}
                    <a
                      href={`/verify?serial=${demo.certificateSerial}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      바로 확인 →
                    </a>
                  </p>
                </li>
              )}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
