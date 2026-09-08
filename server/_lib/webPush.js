// 브라우저 창을 닫아도 도착하는 알림(웹 푸시).
//
// 앞서 만든 알림은 화면이 대화를 확인하다 새 것을 발견하면 그 자리에서 띄우는
// 방식이었다. 그래서 탭을 닫으면 뜨지 않았다 -- 담당자가 퇴근했다 아침에
// 켜면, 밤사이 지원자가 남긴 말은 아무도 알려 주지 않는다.
//
// 웹 푸시는 브라우저 회사의 서버(크롬이면 구글)가 대신 들고 있다가 밀어 준다.
// 창이 닫혀 있어도 서비스워커가 깨어나 알림을 띄운다.
//
// 이 파일이 하는 일은 두 가지다.
//
//   하나. "이 푸시를 보낸 것이 이 서버가 맞다"를 증명한다(VAPID). 아무나
//   남의 구독으로 알림을 보내면 안 되므로, 밀어 주는 서버가 서명을 확인한다.
//
//   둘. 내용을 암호화한다(RFC 8291). 브라우저 회사의 서버를 거쳐 가므로,
//   암호화하지 않으면 그 서버가 대화 내용을 읽는다. 이 앱은 근로계약 협의를
//   다루므로 그건 곤란하다. 열쇠는 구독할 때 브라우저가 준 것만 쓴다.
//
// Workers 에는 이 일을 해 주는 라이브러리가 없다. 대신 WebCrypto 에 필요한
// 조각(ECDH P-256, HKDF, AES-GCM, ECDSA)이 다 있어 규격대로 직접 맞춘다.

const b64urlToBytes = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

const bytesToB64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const concat = (...arrays) => {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const a of arrays) {
    out.set(a, at)
    at += a.length
  }
  return out
}

const utf8 = (s) => new TextEncoder().encode(s)

// HKDF (RFC 5869). 하나의 비밀에서 서로 다른 용도의 열쇠 여러 개를 뽑는다.
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8
  )
  return new Uint8Array(bits)
}

// VAPID 서명. "이 푸시는 이 서버가 보낸 것이다"를 밀어 주는 서버에 증명한다.
//
// 유효기간을 12시간으로 둔다. 규격 상한은 24시간이고, 서버 시계가 조금
// 어긋나도 거절되지 않을 만큼은 짧게 잡는다.
const VAPID_TTL_SECONDS = 12 * 60 * 60

async function vapidHeader(endpoint, { publicKey, privateKey, subject }) {
  const aud = new URL(endpoint).origin
  const header = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = bytesToB64url(
    utf8(
      JSON.stringify({
        aud,
        exp: Math.floor(Date.now() / 1000) + VAPID_TTL_SECONDS,
        sub: subject,
      })
    )
  )
  const signingInput = `${header}.${payload}`

  // 개인키는 32바이트 d 값이다. WebCrypto 는 JWK 로만 받으므로, 공개키에서
  // x·y 를 떼어 함께 넣는다 -- 셋이 맞지 않으면 import 자체가 실패한다.
  const pub = b64urlToBytes(publicKey)
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: privateKey,
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    ext: true,
  }
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    utf8(signingInput)
  )
  // WebCrypto 는 r||s 원시 64바이트로 준다. JWT 가 요구하는 형식과 같다.
  return `vapid t=${signingInput}.${bytesToB64url(sig)}, k=${publicKey}`
}

// 본문 암호화 (RFC 8291, aes128gcm).
//
// 구독할 때 브라우저가 준 두 값을 쓴다 -- p256dh(그 브라우저의 공개키)와
// auth(공유 비밀). 이 서버는 매번 일회용 키 한 쌍을 만들어 ECDH 로 비밀을
// 맞추고, 그것으로 내용을 잠근다. 밀어 주는 서버는 열지 못한다.
const RECORD_SIZE = 4096

async function encryptPayload(plaintext, { p256dh, auth }) {
  const uaPublic = b64urlToBytes(p256dh)
  const authSecret = b64urlToBytes(auth)

  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))

  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256)
  )

  // 공유 비밀 -> 입력 열쇠. 두 공개키를 함께 섞어, 이 대화 상대에게만 맞는
  // 값이 되게 한다.
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(authSecret, shared, keyInfo, 32)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12)

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // 규격이 요구하는 구분자. 마지막 레코드라는 뜻이다.
  const padded = concat(utf8(plaintext), new Uint8Array([0x02]))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded)
  )

  // 머리글: salt(16) | 레코드 크기(4) | 공개키 길이(1) | 공개키(65)
  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, RECORD_SIZE, false)
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext)
}

export function vapidConfigured(env) {
  return !!(env?.VAPID_PRIVATE_KEY && env?.VAPID_PUBLIC_KEY)
}

// 한 구독에게 한 건 보낸다.
//
// 결과를 그대로 돌려준다. 410/404 는 그 구독이 죽었다는 뜻이라(브라우저를
// 지웠거나 알림을 껐다) 부르는 쪽이 지워야 한다. 살아 있는 구독만 남겨 두지
// 않으면 매번 죽은 주소로 보내다 실패한다.
export async function sendPush(env, subscription, payload) {
  if (!vapidConfigured(env)) return { ok: false, gone: false, status: 0, reason: 'not_configured' }

  const body = await encryptPayload(JSON.stringify(payload), {
    p256dh: subscription.p256dh,
    auth: subscription.auth,
  })
  const authorization = await vapidHeader(subscription.endpoint, {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || 'mailto:no-reply@portfolio-epa.pages.dev',
  })

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
  })

  return {
    ok: res.ok,
    // 이 두 가지만 '죽은 구독'이다. 429·5xx 는 지금 못 보낸 것뿐이라 지우면 안 된다.
    gone: res.status === 404 || res.status === 410,
    status: res.status,
    reason: res.ok ? null : (await res.text().catch(() => '')).slice(0, 200),
  }
}

// 한 사람의 모든 기기에 보내고, 죽은 구독은 치운다.
export async function pushToUser(env, userId, payload) {
  if (!userId || !vapidConfigured(env)) return { sent: 0, removed: 0 }

  const { results } = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?'
  )
    .bind(userId)
    .all()
  if (!results?.length) return { sent: 0, removed: 0 }

  let sent = 0
  const dead = []
  for (const sub of results) {
    try {
      const r = await sendPush(env, sub, payload)
      if (r.ok) sent += 1
      else if (r.gone) dead.push(sub.endpoint)
      else console.error(`push failed (${r.status}): ${r.reason}`)
    } catch (err) {
      console.error('push threw:', err)
    }
  }

  if (dead.length > 0) {
    await env.DB.batch(
      dead.map((e) =>
        env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(e)
      )
    ).catch(() => {})
  }
  return { sent, removed: dead.length }
}
