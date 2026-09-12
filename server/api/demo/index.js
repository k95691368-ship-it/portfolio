import { jsonResponse } from '../../_lib/http.js'
import { TRIAL_SECONDS } from '../../_lib/developerTrial.js'

export function onRequestGet() {
  return jsonResponse({ available: true, durationSeconds: TRIAL_SECONDS, emailSending: true })
}
