import { api } from '../api/client.js'

// 창을 닫아도 알림이 오게 한다.
//
// 앞서 만든 알림은 화면이 살아 있어야 뜬다. 탭을 닫으면 그만이다. 웹 푸시는
// 브라우저 회사의 서버가 대신 들고 있다가 밀어 주므로, 창이 없어도 서비스워커가
// 깨어나 알림을 띄운다.
//
// 세 가지가 다 있어야 동작한다 -- 서비스워커, 푸시 지원, 알림 권한. 하나라도
// 없으면 조용히 예전 방식(화면이 떠 있을 때만)으로 돌아간다.

const b64urlToBytes = (s) => {
  const pad = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

const bytesToB64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

export function pushSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window
  )
}

// 서비스워커를 등록한다. 이미 있으면 그것을 쓴다.
//
// 등록은 최상위 경로에 둔다. 하위 경로에 두면 그 아래에서만 동작하는데,
// 알림은 사이트 전체의 일이다.
async function registration() {
  if (!pushSupported()) return null
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  } catch (err) {
    console.error('서비스워커 등록 실패:', err)
    return null
  }
}

// 이 기기가 이미 구독되어 있는가.
export async function pushSubscribed() {
  if (!pushSupported()) return false
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    if (!reg) return false
    return !!(await reg.pushManager.getSubscription())
  } catch {
    return false
  }
}

// 구독하고 서버에 알린다.
//
// 권한은 부르는 쪽에서 이미 받아 둔 상태여야 한다. 여기서 다시 묻지 않는다.
export async function subscribePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }

  let key
  try {
    const res = await api.get('/push/key')
    if (!res?.enabled || !res.publicKey) return { ok: false, reason: 'server_off' }
    key = res.publicKey
  } catch {
    return { ok: false, reason: 'server_off' }
  }

  const reg = await registration()
  if (!reg) return { ok: false, reason: 'no_worker' }

  try {
    // 이미 구독돼 있으면 그것을 그대로 보낸다. 서버 쪽 기록이 지워졌을 수
    // 있어서, 매번 다시 알려 두는 편이 안전하다.
    let sub = await reg.pushManager.getSubscription()

    // 서버 키가 바뀌었으면 옛 구독으로는 알림이 오지 않는다. 조용히 안 오는
    // 것이 가장 나쁘므로, 다르면 버리고 다시 만든다.
    if (sub) {
      const current = sub.options?.applicationServerKey
      const same = current ? bytesToB64url(current) === key : false
      if (!same) {
        await sub.unsubscribe().catch(() => {})
        sub = null
      }
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64urlToBytes(key),
      })
    }

    const json = sub.toJSON()
    await api.post('/push/subscribe', {
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
    })
    return { ok: true }
  } catch (err) {
    console.error('푸시 구독 실패:', err)
    return { ok: false, reason: 'subscribe_failed' }
  }
}

// 구독을 끊는다. 기기에서도 지우고 서버에도 알린다.
//
// 한쪽만 지우면 어긋난다 -- 서버에만 남으면 죽은 주소로 계속 보내고,
// 기기에만 남으면 껐는데 알림이 계속 온다.
export async function unsubscribePush() {
  if (!pushSupported()) return
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return
    const endpoint = sub.endpoint
    await sub.unsubscribe().catch(() => {})
    await api.delete('/push/subscribe', { endpoint }).catch(() => {})
  } catch (err) {
    console.error('푸시 해지 실패:', err)
  }
}
