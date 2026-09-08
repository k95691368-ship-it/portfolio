function objectPath(key: string) {
  return String(key)
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

async function storageError(response: Response) {
  const payload = await response.json().catch(() => null)
  return new Error(payload?.message || payload?.error || `Supabase Storage request failed (${response.status})`)
}

export function createSupabaseStorage(env: Record<string, string>, bucket: string) {
  const base = `${env.SUPABASE_URL}/storage/v1`
  if (!env.SUPABASE_URL) throw new Error('SUPABASE_URL is not configured')

  return {
    async createSignedUploadUrl(key: string) {
      const response = await fetch(
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
      const response = await fetch(
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
      const response = await fetch(`${base}/object/${encodeURIComponent(bucket)}/${objectPath(key)}`, {
        method: 'POST',
        headers: headersFor(env, {
          'Content-Type': options.httpMetadata?.contentType || 'application/octet-stream',
          'x-upsert': 'true',
        }),
        body: value,
      })
      if (!response.ok) throw await storageError(response)
      return response.json().catch(() => ({}))
    },

    async get(key: string, range?: { offset?: number; length?: number }) {
      const rangeHeader = range && Number.isFinite(range.offset)
        ? `bytes=${range.offset}-${Number.isFinite(range.length) ? range.offset + range.length - 1 : ''}`
        : null
      const response = await fetch(`${base}/object/${encodeURIComponent(bucket)}/${objectPath(key)}`, {
        headers: headersFor(env, rangeHeader ? { Range: rangeHeader } : {}),
      })
      if (response.status === 404) return null
      if (!response.ok) throw await storageError(response)
      const contentRange = response.headers.get('Content-Range')
      const total = Number(contentRange?.split('/').pop())
      const size = Number.isFinite(total) ? total : Number(response.headers.get('Content-Length') || 0)
      return {
        body: response.body,
        size,
        range: contentRange ? { offset: Number(contentRange.match(/bytes\s+(\d+)/i)?.[1] || 0) } : null,
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
      const response = await fetch(`${base}/object/${encodeURIComponent(bucket)}/${objectPath(key)}`, {
        headers: headersFor(env, { Range: 'bytes=0-0' }),
      })
      if (response.status === 404) return null
      if (!response.ok) throw await storageError(response)
      const contentRange = response.headers.get('Content-Range')
      const total = Number(contentRange?.split('/').pop())
      return {
        size: Number.isFinite(total) ? total : Number(response.headers.get('Content-Length') || 0),
        httpMetadata: { contentType: response.headers.get('Content-Type') || 'application/octet-stream' },
      }
    },

    async delete(key: string) {
      const response = await fetch(`${base}/object/${encodeURIComponent(bucket)}`, {
        method: 'DELETE',
        headers: headersFor(env, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: [String(key)] }),
      })
      if (!response.ok && response.status !== 404) throw await storageError(response)
    },
  }
}
