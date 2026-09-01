import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { api } from '../api/client.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useDm } from '../context/DmContext.jsx'

// 알림에 실린 /dm/<상대> 주소로 들어오면 쪽지창을 열고 대시보드로 보낸다.
//
// 쪽지창은 화면 하나가 아니라 오른쪽 아래에 떠 있는 것이다. 그래서 이 주소는
// 머무는 곳이 아니라 지나가는 곳이다.
export default function DmLink() {
  const { partnerId } = useParams()
  const { user } = useAuth()
  const { openDm } = useDm()

  useEffect(() => {
    if (!user || !partnerId) return
    // 이름을 모르면 창 머리말이 빈다. 알림에는 id 만 실려 있으므로 한 번 묻는다.
    api
      .get(`/dm/${partnerId}`)
      .then((data) => openDm(data.partner))
      .catch(() => {
        // 더 이상 쪽지를 주고받을 수 없는 상대일 수 있다(정지·탈퇴).
        // 창을 열지 않고 조용히 넘어간다.
      })
  }, [user, partnerId, openDm])

  if (!user) return <Navigate to="/login" replace />
  return <Navigate to="/dashboard" replace />
}
