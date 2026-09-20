function objectPath(key: string) {
  if (typeof key !== 'string' || key.includes('\\') ||
      Array.from(key).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      key.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Invalid storage object path')
  }
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function serviceKey(env: Record<string, string>) {
  if (env.SUPABASE_SERVICE_ROLE_KEY) return env.SUPABASE_SERVICE_ROLE_KEY
  try {
    const keys = JSON.parse(env.SUPABASE_SECRET_KEYS || '{}')
    return keys.default || Object.values(keys)[0] || ''
  } catch {
    return ''
  }
}

function headersFor(env: Record<string, string>, extra: HeadersInit = {}) {
  const key = serviceKey(env)
  if (!key) throw new Error('Supabase server storage key is not configured')
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra,
  }
}

function discardBody(response: Response) {
  if (response.body) void response.body.cancel().catch(() => {})
}

async function storageError(response: Response) {
  discardBody(response)
  // Provider payloads may contain object paths or other private diagnostics.
  return new Error(`Supabase Storage request failed (${response.status})`)
}

function storageRequest(url: string, init: RequestInit = {}, timeoutMs = 30_000) {
  // Never forward the service-role key through redirects. The signal remains
  // active during body consumption, including streaming file downloads.
  return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
}

type StorageRange = { offset?: number; length?: number }
type StorageGetOptions = StorageRange | { range?: StorageRange }

function normalizeRange(options?: StorageGetOptions) {
  const range = options && ('range' in options ? options.range : options as StorageRange)
  if (!range) return null
  const { offset = 0, length } = range
  if (!Number.isSafeInteger(offset) || offset < 0 || (length !== undefined &&
      (!Number.isSafeInteger(length) || length <= 0 || offset > Number.MAX_SAFE_INTEGER - (length - 1)))) {
    throw new Error('Invalid storage range')
  }
  return { offset, length }
}

function validateRangeResponse(response: Response, range: { offset: number; length?: number }) {
  const match = response.headers.get('Content-Range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i)
  const start = Number(match?.[1]), end = Number(match?.[2]), total = Number(match?.[3])
  const contentLength = response.headers.get('Content-Length')
  const encoding = response.headers.get('Content-Encoding')
  if (response.status !== 206 || !response.body || !match ||
      ![start, end, total].every(Number.isSafeInteger) || start !== range.offset || end < start || total <= end ||
      end !== (range.length === undefined ? total - 1 : start + (range.length - 1)) ||
      (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) !== end - start + 1)) ||
      (encoding !== null && encoding.toLowerCase() !== 'identity')) {
    discardBody(response)
    throw new Error('Supabase Storage returned an invalid range response')
  }
  return { size: total, range: { offset: start } }
}

export function createSupabaseStorage(env: Record<string, string>, bucket: string) {
  const base = `${env.SUPABASE_URL}/storage/v1`
  if (!env.SUPABASE_URL) throw new Error('SUPABASE_URL is not configured')

  return {
    async createSignedUploadUrl(key: string) {
      const response = await storageRequest(
        `${base}/object/upload/sign/${encodeURIComponent(bucket)}/${objectPath(key)}`,
        {
          method: 'POST',
          headers: headersFor(env, {
            'Content-Type': 'application/json',
            'x-upsert': 'false',
          }),
          body: '{}',
        }
      )
      if (!response.ok) throw await storageError(response)
      const payload = await response.json()
      const signed = new URL(payload.url, base)
      const token = signed.searchParams.get('token')
      if (!token) throw new Error('Supabase Storage did not return an upload token')
      return { path: key, token }
    },

    async createSignedUrl(key: string, expiresIn = 300, download?: string | boolean) {
      const response = await storageRequest(
        `${base}/object/sign/${encodeURIComponent(bucket)}/${objectPath(key)}`,
        {
          method: 'POST',
          headers: headersFor(env, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ expiresIn }),
        }
      )
      if (!response.ok) throw await storageError(response)
      const payload = await response.json()
      const signed = new URL(`${base}${payload.signedURL}`)
      if (download) signed.searchParams.set('download', download === true ? '' : String(download))
      return { url: signed.toString(), expiresIn }
    },

    async put(key: string, value: BodyInit, options: { httpMetadata?: { contentType?: string } } = {}) {
      const response = await storageRequest(`${base}/object/${encodeURIComponent(bucket)}/${objectPath(key)}`, {
        method: 'POST',
        headers: headersFor(env, {
          'Content-Type': options.httpMetadata?.contentType || 'application/octet-stream',
          'x-upsert': 'true',
        }),
        body: value,
      }, 120_000)
      if (!response.ok) throw await storageError(response)
      return response.json().catch(() => ({}))
    },

    async get(key: string, options?: StorageGetOptions) {
      // The routes use the R2-shaped { range } option; retain direct ranges for
      // existing adapter callers while validating both before any request.
      const range = normalizeRange(options)
      const rangeHeader = range
        ? `bytes=${range.offset}-${range.length === undefined ? '' : range.offset + (range.length - 1)}`
        : null
      const response = await storageRequest(`${base}/object/${encodeURIComponent(bucket)}/${objectPath(key)}`, {
        headers: headersFor(env, rangeHeader ? { Range: rangeHeader, 'Accept-Encoding': 'identity' } : {}),
      }, 300_000)
      if (response.status === 404) { discardBody(response); return null }
      if (!response.ok) throw await storageError(response)
      // A provider may ignore Range and send the entire object. Never let a
      // route advertise that body as the requested 206 response.
      const metadata = range ? validateRangeResponse(response, range) : null
      if (!range && (response.status === 206 || response.headers.has('Content-Range'))) {
        discardBody(response)
        throw new Error('Supabase Storage returned an unexpected partial response')
      }
      return {
        body: response.body,
        size: metadata?.size ?? Number(response.headers.get('Content-Length') || 0),
        range: metadata?.range ?? null,
        httpMetadata: { contentType: response.headers.get('Content-Type') || 'application/octet-stream' },
        writeHttpMetadata(headers: Headers) {
          const type = response.headers.get('Content-Type')
          const encoding = response.headers.get('Content-Encoding')
          if (type) headers.set('Content-Type', type)
          if (encoding) headers.set('Content-Encoding', encoding)
        },
      }
    },

    async head(key: string) {
      const response = await storageRequest(`${base}/object/${encodeURIComponent(bucket)}/${objectPath(key)}`, {
        headers: headersFor(env, { Range: 'bytes=0-0' }),
      })
      if (response.status === 404) { discardBody(response); return null }
      if (!response.ok) throw await storageError(response)
      discardBody(response)
      const contentRange = response.headers.get('Content-Range')
      const total = Number(contentRange?.split('/').pop())
      return {
        size: Number.isFinite(total) ? total : Number(response.headers.get('Content-Length') || 0),
        httpMetadata: { contentType: response.headers.get('Content-Type') || 'application/octet-stream' },
      }
    },

    async delete(key: string) {
      objectPath(key) // Deletion uses a JSON body, but must obey the same key rules.
      const response = await storageRequest(`${base}/object/${encodeURIComponent(bucket)}`, {
        method: 'DELETE',
        headers: headersFor(env, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: [String(key)] }),
      })
      if (!response.ok && response.status !== 404) throw await storageError(response)
      discardBody(response)
    },
  }
}
