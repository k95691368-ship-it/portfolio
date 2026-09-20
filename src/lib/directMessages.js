export function isDirectMessage(message) {
  return !!message && ((Number.isSafeInteger(message.id) && message.id > 0)
    || (typeof message.id === 'string' && /^[1-9]\d{0,18}$/.test(message.id)))
    && typeof message.body === 'string' && typeof message.fromMe === 'boolean'
}

// A poll may have started before a successful POST. Merge immutable messages by
// ID so that such a snapshot cannot remove the acknowledged message. Read marks
// are monotonic; an older unread snapshot must not undo a newer read receipt.
export function mergeDirectMessages(previous, incoming) {
  const messages = new Map(previous.map(message => [String(message.id), message]))
  for (const message of incoming) {
    const id = String(message.id)
    const old = messages.get(id)
    messages.set(id, { ...message, readAt: message.readAt || old?.readAt || null })
  }
  return [...messages.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0).slice(-200)
}
