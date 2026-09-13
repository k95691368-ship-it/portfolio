import { api } from '../../api/client.js'

// Supabase Edge API transport, authenticated by the scoped application/room
// session. A failed heartbeat closes peer media; it never fails open.
export function createAuthorizedChannel(credentials) {
  const path = `/rooms/${credentials.roomId}/interviews/${credentials.sessionId}/signaling`
  const handlers = new Map()
  const seen = new Map()
  let state = {}, closed = false, timer, callback, huddle
  const emit = async (name, payload) => { for (const fn of handlers.get(name) || []) await fn(payload) }
  const post = async (body) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try { return await api.post(path, { ...body, participantId: credentials.participantId }, { signal: controller.signal }) }
    finally { clearTimeout(timeout) }
  }
  async function poll() {
    try {
      const response = await post({ action: 'heartbeat' })
      if (closed) return
      state = Object.fromEntries(response.members.map((member) => [member.participantId, [member]]))
      if (huddle !== response.huddleActive) {
        huddle = response.huddleActive
        await emit('huddle', { payload: { active: huddle } })
      }
      await emit('sync')
      for (const item of response.messages) {
        if (seen.has(item.id)) continue
        seen.set(item.id, Date.now())
        await emit('signal', { payload: item.payload })
      }
      for (const [id, at] of seen) if (Date.now() - at > 60000) seen.delete(id)
      if (!closed) timer = setTimeout(poll, 1000)
    } catch {
      if (closed) return
      closed = true
      state = {}
      await emit('sync')
      await emit('control', { payload: { event: 'meeting-ended' } })
      callback?.('CLOSED')
    }
  }
  return {
    on(_type, { event }, handler) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(handler)
      return this
    },
    subscribe(fn) { callback = fn; void poll().then(() => { if (!closed) void fn('SUBSCRIBED') }); return this },
    presenceState: () => state,
    track: async () => {}, // The server determines identity; ignore client presence.
    send: async ({ event, payload }) => { if (closed) throw new Error('connection_closed'); await post({ action: 'send', event, payload }); return 'ok' },
    untrack: async () => { closed = true; clearTimeout(timer); await post({ action: 'leave' }) },
    unsubscribe: async () => { closed = true; clearTimeout(timer) },
  }
}
