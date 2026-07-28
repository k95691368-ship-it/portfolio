const API_BASE = '/api'

// 서버 응답을 사용자에게 보여줄 오류로 변환한다.
// 권한 거부(403)는 항상 "권한 없음"으로 시작하게 맞춰, 어떤 화면에서 막히든
// 같은 문구로 인지되도록 한다. 상태 코드 자체는 절대 노출하지 않는다.
function toUserError(res, data) {
  let message = data?.error || '요청에 실패했습니다.'
  if (res.status === 403 && !message.startsWith('권한 없음')) {
    message = `권한 없음 — ${message}`
  }
  const error = new Error(message)
  error.status = res.status
  return error
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw toUserError(res, data)
  return data
}

async function upload(path, formData) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw toUserError(res, data)
  return data
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
  upload,
}
