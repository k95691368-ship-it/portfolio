import { smokePolicy, verifySmokeIsolation } from './smoke-policy.mjs'

export function e2ePolicy(env = process.env) {
  const base = env.E2E_API_BASE
  if (!base || env.E2E_ALLOW_WRITES !== '1' || env.E2E_ENVIRONMENT !== 'test') {
    throw new Error('E2E_API_BASE, E2E_ENVIRONMENT=test, E2E_ALLOW_WRITES=1 are required. E2E never defaults to production.')
  }
  if (!/^http:\/\/127\.0\.0\.1(?::\d+)?\/api\/?$/.test(base)) {
    throw new Error('E2E writes require an explicit HTTP 127.0.0.1 local /api target')
  }
  const api = new URL(base)
  api.pathname = '/api'
  return smokePolicy({
    SMOKE_URL: api.origin,
    SMOKE_API_URL: api.href,
    SMOKE_ALLOW_WRITES: '1',
  })
}

export async function verifyE2eIsolation(policy, fetcher = fetch) {
  await verifySmokeIsolation(policy, fetcher)
}

// Test mail is a private local resource, never a fallback to a real inbox.
// Recheck health before reading it, select exactly one synthetic recipient and
// return a token without fetching a link or including mail in error diagnostics.
export async function readE2eVerificationToken(policy, email, fetcher = fetch) {
  const target = e2ePolicy({ E2E_API_BASE: policy.apiBase, E2E_ENVIRONMENT: 'test', E2E_ALLOW_WRITES: '1' })
  if (target.base !== policy.base || policy.allowWrites !== true) throw new Error('Invalid local mailbox target')
  if (typeof email !== 'string' || email.length > 254 || !/^[a-z0-9._+-]+@example\.invalid$/.test(email)) {
    throw new Error('A canonical synthetic recipient is required')
  }
  await verifyE2eIsolation(policy, fetcher)
  const response = await fetcher(new URL('/__local/mail', policy.base), { redirect: 'error' })
  if (response.status !== 200 || response.headers.get('X-Portfolio-Environment') !== 'local') {
    throw new Error('Unverified local mailbox response')
  }
  const articles = (await response.text()).match(/<article>[\s\S]*?<\/article>/g) || []
  const matching = articles.filter(article => article.includes(`<p>수신: ${email} · `))
  if (matching.length !== 1) throw new Error('Missing or ambiguous local verification link')
  const links = [...matching[0].matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)]
  if (links.length !== 1) throw new Error('Missing or ambiguous local verification link')
  let url
  try { url = new URL(links[0][1]) } catch { throw new Error('Invalid local verification link') }
  if (url.origin !== policy.base || url.username || url.password || url.pathname !== '/verify-email' || url.search ||
      !/^#token=[A-Za-z0-9_-]{43}$/.test(url.hash)) {
    throw new Error('Invalid local verification link')
  }
  return url.hash.slice('#token='.length)
}

export function e2eRequest(policy, path, options = {}, fetcher = fetch) {
  if (!/^\/api(?:\/|\?|$)/.test(path)) throw new Error('E2E requests require an /api path')
  return fetcher(`${policy.apiBase}${path.replace(/^\/api/, '')}`, { ...options, redirect: 'error' })
}
