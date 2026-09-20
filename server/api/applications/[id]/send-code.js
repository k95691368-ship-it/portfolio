import { retryApplicationResultEmail } from './send-result-email.js'
import { jsonResponse } from '../../../_lib/http.js'

// Older clients share the same application-level delivery guard.
export async function onRequestPost(context) {
  const response = await retryApplicationResultEmail(context, { passedOnly: true })
  if (!response.ok) return response
  const payload = await response.clone().json()
  if (payload.ok) return response
  // Older clients only inspect the HTTP status, not emailStatus or ok.
  const status = payload.emailStatus === 'not_sent' ? 503
    : payload.emailStatus === 'failed' ? 502 : 409
  return jsonResponse({ ...payload, error: payload.resultEmail.message }, status)
}
