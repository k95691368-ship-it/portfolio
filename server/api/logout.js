import { parseCookie, deleteSession, clearSessionCookieHeader } from '../_lib/auth.js'
import { jsonResponse } from '../_lib/http.js'

export async function onRequestPost({ request, env }) {
  const token = parseCookie(request, 'session')
  if (token) await deleteSession(env.DB, token)
  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearSessionCookieHeader() })
}
