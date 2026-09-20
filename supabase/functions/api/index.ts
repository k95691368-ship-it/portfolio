import { routes } from './routes.generated.js'
import { createPostgresD1 } from './postgresD1.ts'
import { createSupabaseStorage } from './supabaseStorage.ts'
import { onRequest as apiMiddleware } from '../../../server/api/_middleware.js'
import { onRequest as adminMiddleware } from '../../../server/api/admin/_middleware.js'

type RuntimeEnv = Record<string, string> & {
  DB: ReturnType<typeof createPostgresD1>
  DOCUMENTS: ReturnType<typeof createSupabaseStorage>
  INTERVIEW_RECORDINGS: ReturnType<typeof createSupabaseStorage>
}

const deno = (globalThis as typeof globalThis & {
  Deno: {
    env: { toObject: () => Record<string, string> }
    serve: (handler: (request: Request) => Promise<Response>) => void
  }
}).Deno
const environment = deno.env.toObject()
const runtimeEnv: RuntimeEnv = {
  ...environment,
  DB: createPostgresD1(environment.SUPABASE_DB_URL),
  DOCUMENTS: createSupabaseStorage(environment, 'documents'),
  INTERVIEW_RECORDINGS: createSupabaseStorage(environment, 'interview-recordings'),
}

function frontendOrigins(env: Record<string, string>) {
  return new Set(
    [
      'https://portfolio-epa.pages.dev',
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      ...(env.FRONTEND_ORIGINS || '').split(','),
    ]
      .map((origin) => origin.trim())
      .filter(Boolean)
  )
}

const exactOrigins = frontendOrigins(environment)

function allowedOrigin(request: Request) {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  if (exactOrigins.has(origin)) return origin
  try {
    const url = new URL(origin)
    if (
      url.protocol === 'https:' &&
      (url.hostname === 'portfolio-epa.pages.dev' ||
        url.hostname.endsWith('.portfolio-epa.pages.dev'))
    ) {
      return origin
    }
  } catch {
    // Invalid origins are rejected by omission.
  }
  return null
}

function corsHeaders(origin: string | null) {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'apikey, Authorization, Content-Type, Idempotency-Key, X-App-Authorization, X-App-Request, X-Room-Authorization, X-Room-Identity, X-Application-Authorization',
    'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length, Content-Range, X-App-Session-Expires-At',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin, Authorization, X-App-Authorization, X-Room-Authorization, X-Application-Authorization, apikey',
  })
  if (origin) headers.set('Access-Control-Allow-Origin', origin)
  return headers
}

function withCors(response: Response, origin: string | null) {
  const result = new Response(response.body, response)
  for (const [key, value] of corsHeaders(origin)) {
    if (key.toLowerCase() === 'vary' && result.headers.has('Vary')) {
      const existing = result.headers.get('Vary') || ''
      const merged = [...new Set(`${existing}, ${value}`.split(',').map((item) => item.trim()).filter(Boolean))]
      result.headers.set('Vary', merged.join(', '))
    } else {
      result.headers.set(key, value)
    }
  }
  // Supabase is cross-origin from the static site. App authentication therefore
  // travels in scoped headers; never emit the legacy same-origin cookies.
  result.headers.delete('Set-Cookie')
  return result
}

function internalRequest(request: Request, routePath: string) {
  const url = new URL(request.url)
  url.pathname = `/api${routePath}`
  const headers = new Headers(request.headers)
  if (!headers.has('CF-Connecting-IP')) {
    const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) headers.set('CF-Connecting-IP', forwarded)
  }
  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: request.redirect,
    signal: request.signal,
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
  }
  return new Request(url, init)
}

function routeFor(pathname: string) {
  for (const route of routes) {
    const match = pathname.match(route.pattern)
    if (!match) continue
    const params = Object.fromEntries(
      route.params.map((name: string, index: number) => [
        name,
        decodeURIComponent(match[index + 1] || ''),
      ])
    )
    return { route, params }
  }
  return null
}

async function dispatch(request: Request) {
  const externalUrl = new URL(request.url)
  const marker = '/functions/v1/api'
  // The hosted Edge runtime strips `/functions/v1` before the request reaches
  // Deno, while local tooling can preserve the complete public URL. Normalize
  // both forms so the generated routes always receive `/jobs`, `/login`, etc.
  const routePath = externalUrl.pathname.startsWith(marker)
    ? externalUrl.pathname.slice(marker.length) || '/'
    : externalUrl.pathname === '/api'
      ? '/'
      : externalUrl.pathname.startsWith('/api/')
        ? externalUrl.pathname.slice('/api'.length)
        : externalUrl.pathname
  const matched = routeFor(routePath)
  if (!matched) {
    return new Response(JSON.stringify({ error: '요청한 기능을 찾을 수 없습니다.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const requestForHandlers = internalRequest(request, routePath)
  const waiters: Promise<unknown>[] = []
  const context: Record<string, unknown> = {
    request: requestForHandlers,
    env: runtimeEnv,
    data: {},
    params: matched.params,
    waitUntil(promise: Promise<unknown>) {
      waiters.push(Promise.resolve(promise).catch((error) => console.error('Background task failed:', error)))
    },
  }

  const methodHandler = matched.route.module[`onRequest${request.method[0]}${request.method.slice(1).toLowerCase()}`]
  const handler = methodHandler || matched.route.module.onRequest
  if (typeof handler !== 'function') {
    return new Response(JSON.stringify({ error: '지원하지 않는 요청 방식입니다.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'GET, POST, PUT, PATCH, DELETE' },
    })
  }

  const invokeRoute = () => handler(context)
  const invokeAdmin = () => {
    context.next = invokeRoute
    return adminMiddleware(context as never)
  }
  context.next = routePath.startsWith('/admin') ? invokeAdmin : invokeRoute
  const response = await apiMiddleware(context as never)
  if (waiters.length) {
    const background = Promise.allSettled(waiters)
    const edgeRuntime = (globalThis as typeof globalThis & {
      EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void }
    }).EdgeRuntime
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(background)
    else await background
  }
  return response
}

deno.serve(async (request: Request) => {
  const origin = allowedOrigin(request)
  if (request.headers.has('Origin') && !origin) {
    return new Response(JSON.stringify({ error: '허용되지 않은 출처입니다.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...Object.fromEntries(corsHeaders(null)) },
    })
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })

  try {
    return withCors(await dispatch(request), origin)
  } catch (error) {
    console.error('Unhandled API error:', error)
    return withCors(
      new Response(JSON.stringify({ error: '요청을 처리하지 못했습니다.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
      origin
    )
  }
})
