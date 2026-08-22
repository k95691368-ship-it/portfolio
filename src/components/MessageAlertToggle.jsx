import { useState } from 'react'
import { alertsSupported, alertsOn, askAlerts, setAlerts } from '../lib/desktopAlert.js'
import { useToast } from '../context/ToastContext.jsx'

// 담당자에게만 보이는 알림 스위치.
//
// 지원자에게는 이 칸을 보여 주지 않는다. 지원자는 코드로 한 번 들어왔다
// 나가는 사람이라 브라우저 알림이 닿을 자리가 없고, 그 사람에게 가는 알림은
// 메일이다 -- 켜고 끌 것이 없다.
export default function MessageAlertToggle({ label = '지원자가 메시지를 보내면 알림 받기' }) {
    const toast = useToast()
  const [on, setOn] = useState(() => alertsOn())
  const [denied, setDenied] = useState(
    () => alertsSupported() && Notification.permission === 'denied'
  )

  if (!alertsSupported()) return null

  const toggle = async () => {
    if (on) {
      setAlerts(false)
      setOn(false)
      return
    }
    // 권한 요청은 사용자가 누른 직후에만 뜬다. 화면이 뜨자마자 물으면 대부분
    // 반사적으로 거부하고, 한 번 거부하면 브라우저 설정에 들어가기 전에는
    // 다시 물을 수 없다.
    const result = await askAlerts()
    if (result === 'granted') {
      setOn(true)
      toast.success('새 메시지가 오면 이 컴퓨터에 알림이 뜹니다.')
    } else if (result === 'denied') {
      setDenied(true)
    }
  }

  return (
    <div className="alert-toggle">
      <button type="button" className="btn-sm" onClick={toggle} aria-pressed={on}>
        {on ? '알림 끄기' : label}
      </button>
      {denied && (
        <p className="alert-toggle-note">
          이 브라우저에서 알림이 차단되어 있습니다. 주소창 왼쪽 자물쇠 아이콘 → 알림 → 허용으로
          바꾸시면 받을 수 있습니다.
        </p>
      )}
      {on && (
        <p className="alert-toggle-note">
          다른 탭을 보고 있을 때만 뜹니다. 이 창을 닫으면 알림도 멈춥니다.
        </p>
      )}
    </div>
  )
}
