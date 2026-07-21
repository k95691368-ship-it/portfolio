// Excludes visually ambiguous characters (0/O, 1/I/l) since this is a
// credential a person needs to retype accurately.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
const TEMP_PASSWORD_LENGTH = 16

export function genTempPassword() {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length
  const chars = []
  while (chars.length < TEMP_PASSWORD_LENGTH) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0]
    if (byte >= limit) continue
    chars.push(ALPHABET[byte % ALPHABET.length])
  }
  return chars.join('')
}
