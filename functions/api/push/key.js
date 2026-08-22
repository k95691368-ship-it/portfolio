import { jsonResponse } from '../../_lib/http.js'
import { vapidConfigured } from '../../_lib/webPush.js'

// 브라우저가 구독할 때 필요한 공개키.
//
// 감출 값이 아니다 -- 브라우저에 그대로 들어가고, 이것만으로는 아무것도
// 보낼 수 없다. 서명하는 개인키는 서버 시크릿에만 있다.
//
// 코드에 박아 두지 않고 서버가 알려 준다. 박아 두면 키를 갈아 끼울 때
// 화면과 서버가 어긋나는데, 그러면 구독은 되는데 알림만 조용히 안 온다.
export function onRequestGet({ env }) {
  return jsonResponse({
    enabled: vapidConfigured(env),
    publicKey: vapidConfigured(env) ? env.VAPID_PUBLIC_KEY : null,
  })
}
