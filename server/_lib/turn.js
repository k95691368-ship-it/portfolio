// coturn REST credentials: the shared secret never leaves the server.
export async function interviewIceServers(env, participantId) {
  const urls = String(env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const base = [{ urls: 'stun:stun.l.google.com:19302' }]
  if (!urls.length || !env.TURN_SHARED_SECRET) return { iceServers: base, relayConfigured: false }
  if (urls.some((url) => !/^turns?:[a-zA-Z0-9.[\]:-]+(?:\?transport=(?:udp|tcp))?$/.test(url))) throw new Error('TURN_URLS 형식이 잘못되었습니다.')
  const username = `${Math.floor(Date.now() / 1000) + 7200}:${participantId}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TURN_SHARED_SECRET), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username))
  const credential = btoa(String.fromCharCode(...new Uint8Array(digest)))
  return { iceServers: [...base, { urls, username, credential }], relayConfigured: true }
}
