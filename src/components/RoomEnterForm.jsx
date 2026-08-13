import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { useToast } from '../context/ToastContext.jsx'

// 코드만으로 면접방에 들어온다. 로그인 없이.
//
// 지원자가 실제로 머무는 곳은 채용 공고 화면이다. 그런데 면접방으로 들어가는
// 길은 로그인한 사람의 대시보드 안에만 있었고, 첫 화면에서 로그인으로 가는
// 버튼은 '회사 · 채용 담당자 로그인' 하나뿐이었다. 지원자는 그 버튼이 자기
// 것이 아니라고 여겨 누르지 않는다 — 면접방이 만들어져 있어도 못 들어간다.
//
// 서류합격 안내 메일에 담아 보낸 코드를 여기에 넣으면 그 자리에서 들어온다.
export default function RoomEnterForm() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const result = await api.post('/rooms/enter', { inviteCode: code.trim() })
      toast.success(`"${result.title}" 면접방에 입장했습니다.`)
      navigate(`/rooms/${result.roomId}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="room-enter">
      <h2>면접방 입장</h2>
      <p>
        서류 합격 안내 메일로 받으신 <strong>면접방 입장 코드</strong>를 입력하세요. 로그인은 필요하지
        않습니다.
      </p>
      <form onSubmit={submit} className="room-enter-form">
        <label>
          입장 코드
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="예: A3KM7P"
            maxLength={12}
            autoComplete="off"
            required
          />
        </label>
        <button type="submit" className="btn-primary" disabled={busy || !code.trim()}>
          {busy ? '들어가는 중...' : '입장하기'}
        </button>
      </form>
    </section>
  )
}
