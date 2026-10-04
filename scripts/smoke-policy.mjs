const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function loopbackOrigin(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash) {
    throw new Error('Smoke writes require an explicit HTTP 127.0.0.1 local target')
  }
  return url
}

export function smokePolicy(env = process.env) {
  const base = env.SMOKE_URL || 'https://portfolio-epa.pages.dev'
  const apiBase = env.SMOKE_API_URL || 'https://obumqkwkvnemkyaahjbn.supabase.co/functions/v1/api'
  const allowWrites = env.SMOKE_ALLOW_WRITES === '1'
  if (allowWrites) {
    if (!env.SMOKE_URL || !env.SMOKE_API_URL) throw new Error('Both local smoke targets must be explicit')
    const site = loopbackOrigin(base)
    const api = loopbackOrigin(apiBase)
    if (site.origin !== api.origin || !['', '/'].includes(site.pathname) || api.pathname !== '/api') {
      throw new Error('Smoke writes require one local site origin and its /api endpoint')
    }
  }
  return { base, apiBase, allowWrites }
}

export function assertSmokeMethod(policy, method = 'GET') {
  const normalized = method.toUpperCase()
  if (MUTATING_METHODS.has(normalized) && !policy.allowWrites) {
    throw new Error('Mutating smoke requests are disabled; use a verified isolated local target')
  }
  if (!['GET', 'HEAD', ...MUTATING_METHODS].includes(normalized)) throw new Error('Unsupported smoke method')
}

export async function verifySmokeIsolation(policy, fetcher = fetch) {
  if (!policy.allowWrites) return
  const response = await fetcher(new URL('/__local/health', policy.base), { redirect: 'error' })
  if (!response.ok || response.headers.get('x-portfolio-environment') !== 'local') {
    throw new Error('The smoke target is not the isolated local runtime')
  }
  const health = await response.json()
  if (health.environment !== 'local' || health.externalRequests !== false || health.emailDelivery !== 'local-mailbox-only') {
    throw new Error('Smoke writes require blocked external requests and local-only email')
  }
}
