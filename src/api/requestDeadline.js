// Keep a stalled response (including its body) from retaining a shared request
// forever. Never retry writes automatically: the server may have accepted them.
export async function withRequestDeadline(operation, { signal, timeoutMs = 120_000 } = {}) {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
  const controller = new AbortController()
  let onAbort
  const interrupted = new Promise((_, reject) => {
    onAbort = () => reject(controller.signal.reason)
    controller.signal.addEventListener('abort', onAbort, { once: true })
  })
  const forwardAbort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', forwardAbort, { once: true })
  const timer = setTimeout(() => {
    const error = new Error('서버 응답 시간이 초과되었습니다. 요청이 처리되었을 수 있으니 현재 상태를 확인한 뒤 다시 시도해주세요.')
    error.code = 'REQUEST_TIMEOUT'
    error.status = 408
    controller.abort(error)
  }, timeoutMs)
  try {
    return await Promise.race([operation(controller.signal), interrupted])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
    controller.signal.removeEventListener('abort', onAbort)
  }
}
