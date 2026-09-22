import { describe, it, expect, vi, afterEach } from 'vitest'
import { webcrypto } from 'node:crypto'
import { sendPush, vapidConfigured, validPushEndpoint, validPushSubscription, pushToUser } from '../server/_lib/webPush.js'
import { onRequestPost as subscribe } from '../server/api/push/subscribe.js'
import { sqliteApp, seedUser } from './helpers/sqliteApp.js'

// 웹 푸시는 눈에 보이지 않는 곳에서 두 가지를 한다 -- 서명과 암호화.
// 둘 중 하나만 어긋나도 밀어 주는 서버가 조용히 거절하고, 알림은 그냥
// 안 온다. "안 오는 것"은 알아차리기 가장 어려운 고장이라 여기서 잡는다.

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto

// 실제로 쓰는 것과 같은 방식으로 만든 시험용 키 한 쌍.
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function makeVapid() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )
  const raw = await webcrypto.subtle.exportKey('raw', pair.publicKey)
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey)
  return { publicKey: b64url(raw), privateKey: jwk.d }
}

// 브라우저가 구독할 때 주는 값과 같은 모양.
async function makeSubscription() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])
  const raw = await webcrypto.subtle.exportKey('raw', pair.publicKey)
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    p256dh: b64url(raw),
    auth: b64url(webcrypto.getRandomValues(new Uint8Array(16))),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('웹 푸시', () => {
  it('키가 없으면 보내지 않는다', async () => {
    expect(vapidConfigured({})).toBe(false)
    const r = await sendPush({}, await makeSubscription(), { title: 'x' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not_configured')
  })

  it('규격이 요구하는 머리글을 붙인다', async () => {
    const vapid = await makeVapid()
    const sub = await makeSubscription()
    let sent = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      sent = { url, init }
      return new Response('', { status: 201 })
    })

    const r = await sendPush(
      { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey },
      sub,
      { title: '새 메시지' }
    )
    expect(r.ok).toBe(true)
    expect(sent.url).toBe(sub.endpoint)
    // 이 세 가지가 없으면 밀어 주는 서버가 받지 않는다.
    expect(sent.init.headers['Content-Encoding']).toBe('aes128gcm')
    expect(sent.init.headers.TTL).toBe('86400')
    expect(sent.init.headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/)
    expect(sent.init.redirect).toBe('error')
    expect(sent.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('서명이 실제로 검증된다', async () => {
    // 서명 형식만 맞고 값이 틀리면 밀어 주는 서버가 거절한다. 우리 공개키로
    // 직접 검증해 본다.
    const vapid = await makeVapid()
    let auth = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      auth = init.headers.Authorization
      return new Response('', { status: 201 })
    })
    await sendPush(
      { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey },
      await makeSubscription(),
      { title: 'x' }
    )

    const token = auth.slice('vapid t='.length, auth.indexOf(', k='))
    const [h, p, sig] = token.split('.')
    const key = await webcrypto.subtle.importKey(
      'raw',
      Buffer.from(vapid.publicKey, 'base64url'),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
    const good = await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      Buffer.from(sig, 'base64url'),
      new TextEncoder().encode(`${h}.${p}`)
    )
    expect(good).toBe(true)

    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf-8'))
    // 대상이 밀어 주는 서버의 주소여야 한다. 다르면 그 서버가 거절한다.
    expect(claims.aud).toBe('https://fcm.googleapis.com')
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
    // 24시간을 넘기면 규격 위반이다.
    expect(claims.exp).toBeLessThan(Math.floor(Date.now() / 1000) + 24 * 60 * 60)
  })

  it('본문을 암호화해 보낸다 — 밀어 주는 서버가 읽으면 안 된다', async () => {
    const vapid = await makeVapid()
    let body = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      body = new Uint8Array(init.body)
      return new Response('', { status: 201 })
    })
    await sendPush(
      { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey },
      await makeSubscription(),
      { title: '기본급 협의', body: '월 250만원으로 하시죠' }
    )

    const asText = Buffer.from(body).toString('utf-8')
    expect(asText).not.toContain('기본급')
    expect(asText).not.toContain('250')

    // 머리글 모양: salt(16) | 레코드크기(4) | 키길이(1)=65 | 공개키(65)
    expect(body.length).toBeGreaterThan(86)
    expect(body[20]).toBe(65)
    const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false)
    expect(rs).toBe(4096)
  })

  it('죽은 구독만 지울 대상으로 표시한다', async () => {
    const vapid = await makeVapid()
    const env = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey }
    const sub = await makeSubscription()

    for (const [status, gone] of [
      [404, true],
      [410, true],
      // 지금 못 보낸 것뿐이다. 지우면 그 사람은 영영 알림을 못 받는다.
      [429, false],
      [500, false],
      [503, false],
    ]) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status }))
      const r = await sendPush(env, sub, { title: 'x' })
      expect(r.gone, `status ${status}`).toBe(gone)
    }
  })

  it('rejects stored non-push URLs before making any network request', async () => {
    const vapid = await makeVapid()
    const subscription = await makeSubscription()
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 201 }))
    for (const endpoint of ['https://www.googleapis.com/anything', 'https://www.apple.com/', 'https://127.0.0.1/', 'https://fcm.googleapis.com@localhost/', 'https://fcm.googleapis.com:444/send']) {
      const result = await sendPush({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey },
        { ...subscription, endpoint }, { title: 'x' })
      expect(result.reason).toBe('invalid_subscription')
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not buffer the push provider response body or expose it in logs', async () => {
    const vapid = await makeVapid()
    const cancel = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('private-provider-response')) }, cancel,
    }), { status: 503 }))
    const result = await sendPush({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey }, await makeSubscription(), { title: 'x' })
    expect(cancel).toHaveBeenCalled()
    expect(result.reason).toBe('provider_error')
  })

  it('accepts standard browser push providers but rejects credentials, fragments and misleading hosts', () => {
    for (const url of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://wns2.notify.windows.com/w/?token=abc', 'https://web.push.apple.com/abc']) {
      expect(validPushEndpoint(url), url).toBe(true)
    }
    for (const url of ['http://fcm.googleapis.com/abc', 'https://fcm.googleapis.com.evil.invalid/abc', 'https://user:password@fcm.googleapis.com/abc', 'https://fcm.googleapis.com/abc#fragment', 'https://evilnotify.windows.com/']) {
      expect(validPushEndpoint(url), url).toBe(false)
    }
  })

  it('validates both key lengths and the actual P-256 curve point', async () => {
    const subscription = await makeSubscription()
    expect(await validPushSubscription(subscription)).toBe(true)
    expect(await validPushSubscription({ ...subscription, auth: b64url(new Uint8Array(15)) })).toBe(false)
    const offCurve = new Uint8Array(65); offCurve[0] = 4
    expect(await validPushSubscription({ ...subscription, p256dh: b64url(offCurve) })).toBe(false)
  })

  it('registers valid subscriptions, rejects malformed ones, and rate-limits registration in a real database', async () => {
    const db = sqliteApp()
    try {
      const user = seedUser(db, 'push-user')
      const env = { DB: db, VAPID_PUBLIC_KEY: 'unused', VAPID_PRIVATE_KEY: 'unused' }
      const subscription = await makeSubscription()
      const call = (body) => subscribe({ env, data: { user }, request: new Request('https://test.invalid/api/push/subscribe', { method: 'POST', body: JSON.stringify(body) }) })
      expect((await call(subscription)).status).toBe(201)
      expect((await call({ ...subscription, auth: 'invalid' })).status).toBe(400)
      for (let i = 0; i < 18; i++) expect((await call(subscription)).status).toBe(201)
      expect((await call(subscription)).status).toBe(429)
      expect(db.sql.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n).toBe(1)
    } finally { db.close() }
  })

  it.each(['owner', 'keys'])('does not delete a subscription whose %s changed while sending', async (change) => {
    const db = sqliteApp()
    try {
      seedUser(db, 'push-before'); seedUser(db, 'push-after')
      const vapid = await makeVapid()
      const sub = await makeSubscription()
      db.sql.prepare('INSERT INTO push_subscriptions (endpoint,user_id,p256dh,auth) VALUES (?,?,?,?)').run(sub.endpoint, 'push-before', sub.p256dh, sub.auth)
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        if (change === 'owner') db.sql.exec("UPDATE push_subscriptions SET user_id = 'push-after'")
        else db.sql.prepare('UPDATE push_subscriptions SET auth = ?').run(b64url(new Uint8Array(16)))
        return new Response(null, { status: 410 })
      })
      const result = await pushToUser({ DB: db, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey }, 'push-before', { title: 'x' })
      expect(result.removed).toBe(0)
      expect(db.sql.prepare('SELECT user_id FROM push_subscriptions').get().user_id).toBe(change === 'owner' ? 'push-after' : 'push-before')
    } finally { db.close() }
  })

  it('sends to devices concurrently with at most four in flight', async () => {
    const db = sqliteApp()
    const release = []
    let flight, autoRelease = false, active = 0, peak = 0
    try {
      seedUser(db, 'push-parallel')
      const vapid = await makeVapid()
      const sub = await makeSubscription()
      for (let i = 0; i < 9; i++) db.sql.prepare('INSERT INTO push_subscriptions (endpoint,user_id,p256dh,auth) VALUES (?,?,?,?)')
        .run(`${sub.endpoint}-${i}`, 'push-parallel', sub.p256dh, sub.auth)
      const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        active++; peak = Math.max(peak, active)
        if (!autoRelease) await new Promise((resolve) => release.push(resolve))
        active--
        return new Response(null, { status: 201 })
      })
      flight = pushToUser({ DB: db, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey }, 'push-parallel', { title: 'x' })
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
      expect(peak).toBe(4)
      release.splice(0).forEach((resolve) => resolve())
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(8))
      expect(peak).toBe(4)
      autoRelease = true
      release.splice(0).forEach((resolve) => resolve())
      expect(await flight).toEqual({ sent: 9, removed: 0 })
      expect(fetch).toHaveBeenCalledTimes(9)
    } finally {
      autoRelease = true
      release.splice(0).forEach((resolve) => resolve())
      if (flight) await flight
      db.close()
    }
  })

  it('isolates failed devices and removes only expired subscriptions during parallel sending', async () => {
    const db = sqliteApp()
    try {
      seedUser(db, 'push-mixed')
      const vapid = await makeVapid()
      const sub = await makeSubscription()
      const statuses = [201, 410, 404, 429, 503, 0]
      for (const status of statuses) db.sql.prepare('INSERT INTO push_subscriptions (endpoint,user_id,p256dh,auth) VALUES (?,?,?,?)')
        .run(`${sub.endpoint}-${status}`, 'push-mixed', sub.p256dh, sub.auth)
      const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const status = Number(url.split('-').pop())
        if (!status) throw new Error('Test transport failure')
        return new Response(null, { status })
      })
      vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(await pushToUser({ DB: db, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey }, 'push-mixed', { title: 'x' }))
        .toEqual({ sent: 1, removed: 2 })
      expect(fetch).toHaveBeenCalledTimes(6)
      const remaining = db.sql.prepare('SELECT endpoint FROM push_subscriptions').all().map((row) => Number(row.endpoint.split('-').pop())).sort((a, b) => a - b)
      expect(remaining).toEqual([0, 201, 429, 503])
    } finally { db.close() }
  })
})
