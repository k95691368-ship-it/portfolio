import { useEffect, useState } from 'react'
import { alertsSupported, alertsOn, askAlerts, setAlerts } from '../lib/desktopAlert.js'
import { subscribePush, unsubscribePush, pushSubscribed } from '../lib/pushSubscribe.js'
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
  // 창을 닫아도 오는가. 처음에는 모르고, 켜 본 뒤에 정해진다.
  const [pushed, setPushed] = useState(false)

  useEffect(() => {
    if (!on) return
    // 이미 켜 둔 사람도 구독이 살아 있는지 확인한다. 브라우저가 구독을
    // 만료시키기도 하고, 서버 기록만 사라졌을 수도 있다.
    let alive = true
    pushSubscribed().then((yes) => {
      if (alive) setPushed(yes)
    })
    return () => {
      alive = false
    }
  }, [on])

  if (!alertsSupported()) return null

  const toggle = async () => {
    if (on) {
      setAlerts(false)
      setOn(false)
      // 기기와 서버 양쪽에서 지운다. 한쪽만 지우면 껐는데 계속 오거나,
      // 서버가 죽은 주소로 계속 보낸다.
      await unsubscribePush()
      setPushed(false)
      return
    }
    // 권한 요청은 사용자가 누른 직후에만 뜬다. 화면이 뜨자마자 물으면 대부분
    // 반사적으로 거부하고, 한 번 거부하면 브라우저 설정에 들어가기 전에는
    // 다시 물을 수 없다.
    const result = await askAlerts()
    if (result === 'granted') {
      setOn(true)
      // 창을 닫아도 오게 한다. 실패해도 알림 자체는 동작하므로(화면이 떠
      // 있는 동안) 끄지 않고, 어디까지 되는지만 다르게 말한다.
      const push = await subscribePush()
      setPushed(push.ok)
      toast.success(
        push.ok
          ? '새 메시지가 오면 알림이 뜹니다. 창을 닫아 두어도 도착합니다.'
          : '새 메시지가 오면 알림이 뜹니다. 이 브라우저에서는 창을 열어 둔 동안만 도착합니다.'
      )
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
          {pushed
            ? '다른 일을 하는 동안에도 뜹니다. 이 창을 닫아 두어도 도착합니다.'
            : '이 창을 열어 둔 동안에만 뜹니다.'}
        </p>
      )}
    </div>
  )
}
