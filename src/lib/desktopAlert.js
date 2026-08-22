// 지원자가 말을 걸면 담당자 컴퓨터에 알림을 띄운다.
//
// 담당자는 일하는 내내 이 사이트를 열어 두지만, 면접방 탭을 계속 보고 있지는
// 않다. 다른 탭에서 일하는 동안 지원자가 조건을 묻거나 출근일을 물어도 몇
// 시간 뒤에야 본다. 협의가 멈추면 계약이 멈춘다.
//
// 브라우저가 띄우는 알림을 쓴다. 서버가 밀어 주는 방식(웹 푸시)이 아니라,
// 화면이 대화를 확인하다 새 것을 발견하면 그 자리에서 띄우는 방식이다.
// 그래서 탭이 아예 닫혀 있으면 뜨지 않는다 -- 지원자 쪽에 메일을 쓰는 이유가
// 이것이다. 담당자는 열어 두고, 지원자는 열어 두지 않는다.

const STORE_KEY = 'desktopAlerts'

export function alertsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

// 허용을 눌러 두었는가. 브라우저 권한과 이 사이트의 설정이 모두 켜져야 띄운다.
//
// 브라우저 권한만 보면 안 된다. 한 번 허용하면 그 뒤로 계속 허용 상태라,
// 사용자가 이 사이트에서 끄고 싶어도 브라우저 설정까지 들어가야 한다.
export function alertsOn() {
  if (!alertsSupported() || Notification.permission !== 'granted') return false
  try {
    return localStorage.getItem(STORE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setAlerts(on) {
  try {
    localStorage.setItem(STORE_KEY, on ? 'on' : 'off')
  } catch {
    /* 저장소를 못 써도 이번 세션에서는 동작한다 */
  }
}

// 권한을 묻는다. 크롬이 "알림을 보내는 것을 허용하시겠습니까"를 띄운다.
//
// 사용자가 버튼을 누른 직후에만 부른다. 화면이 뜨자마자 물으면 대부분 반사적으로
// 거부하고, 한 번 거부하면 브라우저 설정에 들어가기 전에는 다시 물을 수 없다.
export async function askAlerts() {
  if (!alertsSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const result =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (result === 'granted') setAlerts(true)
  return result
}

// 새 메시지를 알린다.
//
// 화면을 보고 있으면 띄우지 않는다. 눈앞에 이미 떠 있는 것을 다시 알리는 것은
// 알림이 아니라 방해다.
//
// 여러 줄이 한꺼번에 와도 알림은 하나만 띄운다. tag 를 같은 값으로 두면
// 브라우저가 같은 자리를 덮어쓴다 -- 대화가 활발할수록 알림이 쌓이면 곤란하다.
export function alertNewMessages(messages, { roomTitle, onClick } = {}) {
  if (!alertsOn()) return false
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return false
  if (!Array.isArray(messages) || messages.length === 0) return false

  const last = messages[messages.length - 1]
  const who = last.senderName || '지원자'
  const body =
    messages.length > 1
      ? `${who}님 외 새 메시지 ${messages.length}건`
      : String(last.body || '').slice(0, 80)

  try {
    const n = new Notification(roomTitle ? `${roomTitle} · 새 메시지` : '새 메시지', {
      body,
      tag: 'room-message',
      renotify: true,
    })
    n.onclick = () => {
      window.focus()
      n.close()
      onClick?.()
    }
    return true
  } catch {
    // 일부 브라우저(모바일 크롬)는 서비스워커 없이 Notification 생성을 막는다.
    // 알림이 안 뜨는 것으로 끝나야지 화면이 죽으면 안 된다.
    return false
  }
}
