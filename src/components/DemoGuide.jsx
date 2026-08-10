import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'

// 평가자용 체험 안내.
//
// 이 서비스가 하는 일의 대부분은 로그인 뒤에 있다. 처음 온 사람이 계정을 만들고
// 상대 역할까지 준비해서 서명까지 가야만 핵심이 보인다면, 그건 아무도 보지 않는
// 기능과 같다. 이미 진행된 계약을 미리 심어 두고 그 문을 열어 준다.
//
// 데모가 심어져 있지 않으면 아무것도 그리지 않는다 — 없는 계정을 안내하는 것이
// 안내가 없는 것보다 나쁘다.

export default function DemoGuide() {
  const [demo, setDemo] = useState(null)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    api
      .get('/demo')
      .then((d) => setDemo(d.seeded ? d : null))
      .catch(() => setDemo(null))
  }, [])

  if (!demo) return null

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label}을(를) 복사했습니다.`)
    } catch {
      toast.error('복사할 수 없습니다. 직접 선택해 복사해주세요.')
    }
  }

  return (
    <section className="demo-guide">
      <div className="demo-guide-head">
        <span className="badge badge-accent">채용 담당자용</span>
        <h2>1시간 체험</h2>
      </div>
      <p className="demo-guide-lead">
        아래 계정으로 로그인하면 계약 체결까지 진행된 상태에서 시작합니다. 실제 서비스와 같은 화면이며,
        데이터는 시연용 예시입니다.
      </p>

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
          <button type="button" className="btn-sm" onClick={() => copy(demo.password, '비밀번호')}>
            복사
          </button>
        </div>
      </div>

      <button type="button" className="btn-primary" onClick={() => navigate('/login')}>
        체험 시작하기
      </button>
      <button type="button" className="btn-sm demo-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '순서 접기' : '무엇을 보게 되나요?'}
      </button>

      {open && (
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
                이미 발급된 증명서가 있습니다. 발급번호 <code>{demo.certificateSerial}</code> 를 확인
                화면에 넣어 보세요.{' '}
                <a href={`/verify?serial=${demo.certificateSerial}`} target="_blank" rel="noreferrer">
                  바로 확인 →
                </a>
              </p>
            </li>
          )}
        </ol>
      )}
    </section>
  )
}
