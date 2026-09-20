import { routes } from '../../supabase/functions/api/routes.generated.js'
import { onRequest as middleware } from '../../server/api/_middleware.js'
import { onRequest as adminMiddleware } from '../../server/api/admin/_middleware.js'
import { jsonError } from '../../server/_lib/http.js'

export const routeCount = routes.length

export async function dispatch(request, env) {
  const path = new URL(request.url).pathname.slice('/api'.length) || '/'
  const route = routes.find(item => item.pattern.test(path))
  if (!route) return jsonError('요청한 기능을 찾을 수 없습니다.', 404)
  let params
  try {
    const match = path.match(route.pattern)
    params = Object.fromEntries(route.params.map((name, index) => [name, decodeURIComponent(match[index + 1] || '')]))
  } catch { return jsonError('잘못된 경로입니다.', 400) }
  const handler = route.module[`onRequest${request.method[0]}${request.method.slice(1).toLowerCase()}`] || route.module.onRequest
  if (typeof handler !== 'function') return jsonError('지원하지 않는 요청 방식입니다.', 405)
  const pending = []
  const context = { request, env, params, data: {}, waitUntil(promise) { pending.push(Promise.resolve(promise)) } }
  const invoke = () => handler(context)
  context.next = path.startsWith('/admin/') || path === '/admin'
    ? () => { context.next = invoke; return adminMiddleware(context) } : invoke
  let response
  try { response = await middleware(context) }
  catch { response = jsonError('로컬 요청을 처리하지 못했습니다.', 500) }
  await Promise.allSettled(pending)
  // Match hosted scoped-header auth, not the legacy cookie fallback.
  const result = new Response(response.body, response)
  result.headers.delete('Set-Cookie')
  return result
}
