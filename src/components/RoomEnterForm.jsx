import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, markRoomDoor } from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { formatInviteCode, normalizeInviteCode } from '../lib/inviteCode.js'

// 코드만으로 면접방에 들어온다. 계정 로그인 없이.
//
// 지원자가 실제로 머무는 곳은 채용 공고 화면이다. 그런데 면접방으로 들어가는
// 길은 로그인한 사람의 대시보드 안에만 있었고, 첫 화면에서 로그인으로 가는
// 버튼은 '회사 · 채용 담당자 로그인' 하나뿐이었다. 지원자는 그 버튼이 자기
// 것이 아니라고 여겨 누르지 않는다 — 면접방이 만들어져 있어도 못 들어간다.
//
// 서류합격 안내 메일에 담아 보낸 코드를 여기에 넣으면 그 자리에서 들어온다.
// 회사 계정으로 로그인한 컴퓨터에서도 마찬가지다 — 코드 세션은 이름이 다른
// 쿠키에 담기므로 회사 로그인은 그대로 살아 있고, 그 방에서만 지원자가 된다.
export default function RoomEnterForm() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()

  const clean = normalizeInviteCode(code)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const result = await api.post('/rooms/enter', { inviteCode: clean })
      // 이 방은 코드로 들어온 방이라고 적어 둔다. 이 표시가 없으면 회사
      // 계정이 함께 있는 브라우저에서 서버가 회사 쪽을 고른다.
      markRoomDoor(result.roomId, 'code')
      toast.success(`${result.displayName}님, "${result.title}" 면접방에 입장했습니다.`)
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
        서류 합격 안내 메일로 받으신 <strong>면접방 입장 코드</strong>를 입력하세요. 회원가입이나
        로그인은 필요하지 않습니다.
      </p>
      {user?.role === 'company' && (
        // 담당자가 자기 컴퓨터에서 코드를 넣어 보는 일이 실제로 있다. 회사
        // 로그인이 사라지는 것으로 오해하지 않도록 먼저 말해 둔다.
        <p className="room-enter-note">
          지금 회사 계정({user.displayName})으로 로그인되어 있습니다. 코드로 들어가면 <strong>그
          면접방에서만</strong> 지원자로 참여하게 되며, 회사 로그인은 그대로 유지됩니다.
        </p>
      )}
      <form onSubmit={submit} className="room-enter-form">
        <label>
          입장 코드
          <input
            value={code}
            onChange={(e) => setCode(formatInviteCode(e.target.value))}
            placeholder="예: AC3K-M7PQ-4RTV"
            // 12자리에 하이픈 두 개. 메일에서 통째로 붙여 넣는 사람이 있다.
            maxLength={14}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        <button type="submit" className="btn-primary" disabled={busy || !clean}>
          {busy ? '들어가는 중...' : '입장하기'}
        </button>
      </form>
    </section>
  )
}
