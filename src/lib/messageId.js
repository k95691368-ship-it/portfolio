// PostgreSQL BIGINT may arrive as a decimal string, while SQLite returns safe
// numbers. Never round an ID through Number or compare string IDs lexically.
const MAX_MESSAGE_ID = '9223372036854775807'

export function messageIdKey(value, { allowZero = false } = {}) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const text = String(value)
  if (!/^(0|[1-9]\d{0,18})$/.test(text) || (!allowZero && text === '0')) return null
  if (text.length === MAX_MESSAGE_ID.length && text > MAX_MESSAGE_ID) return null
  return text
}

export function compareMessageIds(first, second) {
  const a = BigInt(first), b = BigInt(second)
  return a < b ? -1 : a > b ? 1 : 0
}
