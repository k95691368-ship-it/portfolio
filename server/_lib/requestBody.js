// Apply before any JSON/multipart parser: Content-Length alone is not a limit.
const MiB = 1024 * 1024
export function requestBodyLimit(pathname) {
  if (/^\/api\/jobs\/[^/]+\/apply\/?$/.test(pathname)) return 21 * MiB // Two 10 MiB files + fields.
  if (/^\/api\/documents\/upload\/?$/.test(pathname)) return 11 * MiB
  if (/^\/api\/rooms\/[^/]+\/signed-contract\/?$/.test(pathname)) return 9 * MiB
  if (/^\/api\/rooms\/[^/]+\/sign\/?$/.test(pathname)) return 2 * MiB
  return 256 * 1024
}

export class RequestBodyError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

export async function boundedRequest(request) {
  if (!request.body) return request
  const limit = requestBodyLimit(new URL(request.url).pathname)
  const tooLarge = () => new RequestBodyError(413, '요청 데이터가 허용 크기를 초과했습니다.')
  if (Number(request.headers.get('Content-Length')) > limit) {
    void request.body.cancel().catch(() => {})
    throw tooLarge()
  }
  const reader = request.body.getReader()
  let timer, finished = false
  const timeoutMs = limit > 256 * 1024 ? 120_000 : 30_000
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new RequestBodyError(408, '데이터 전송 시간이 초과되었습니다. 다시 시도해주세요.')), timeoutMs)
  })
  const readBody = async () => {
    // Retain bytes, not one object/promise per network chunk. A sender using tiny
    // chunks must not turn a small byte budget into millions of retained objects.
    let buffer = new Uint8Array(Math.min(8192, limit))
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) { finished = true; break }
      const nextLength = length + value.byteLength
      if (nextLength > limit) throw tooLarge()
      if (nextLength > buffer.length) {
        const grown = new Uint8Array(Math.min(limit, Math.max(nextLength, buffer.length * 2)))
        grown.set(buffer.subarray(0, length))
        buffer = grown
      }
      buffer.set(value, length)
      length = nextLength
    }
    return buffer.subarray(0, length)
  }
  try {
    const body = await Promise.race([readBody(), deadline])
    return new Request(request.url, {
      method: request.method, headers: request.headers, body,
      signal: request.signal, redirect: request.redirect,
    })
  } finally {
    clearTimeout(timer)
    if (!finished) void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
