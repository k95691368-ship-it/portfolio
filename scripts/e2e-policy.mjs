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

export function e2eRequest(policy, path, options = {}, fetcher = fetch) {
  if (!/^\/api(?:\/|\?|$)/.test(path)) throw new Error('E2E requests require an /api path')
  return fetcher(`${policy.apiBase}${path.replace(/^\/api/, '')}`, { ...options, redirect: 'error' })
}
