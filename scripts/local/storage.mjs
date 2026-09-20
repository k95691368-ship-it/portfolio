import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, unlink, lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

export async function privateDirectory(path) {
  if (!isAbsolute(path) || path.startsWith('\\\\')) throw new Error('Local directory must be an absolute, non-network path')
  await mkdir(path, { recursive: true, mode: 0o700 })
  if ((await lstat(path)).isSymbolicLink()) throw new Error('Local directory must not be a symbolic link')
  return realpath(path)
}

export function inside(root, path) {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export async function createLocalStorage(directory, maxBytes = 21 * 1024 * 1024) {
  const root = await privateDirectory(directory)
  const pathFor = (key) => {
    if (typeof key !== 'string' || key.length > 2000 || key.includes('\\') ||
        Array.from(key).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || key.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Invalid local object key')
    }
    // Hash the entire key: no user-controlled path segment reaches the filesystem.
    return join(root, `${createHash('sha256').update(key).digest('hex')}.json`)
  }
  const stored = async (key) => {
    const path = pathFor(key)
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error('Invalid local object')
      const record = JSON.parse(await readFile(path, 'utf8'))
      if (record.key !== key || typeof record.content !== 'string') throw new Error('Invalid local object')
      return record
    } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  return {
    async put(key, value, options = {}) {
      const path = pathFor(key)
      const reader = new Response(value).body?.getReader()
      const chunks = []
      let size = 0
      try {
        while (reader) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > maxBytes) throw new Error('Local upload exceeds the size limit')
          chunks.push(chunk.value)
        }
      } catch (error) { await reader?.cancel().catch(() => {}); throw error }
      finally { reader?.releaseLock() }
      const contentType = options.httpMetadata?.contentType || 'application/octet-stream'
      // Contract archives include a charset; video types may include codecs.
      // Preserve parameters but never permit response-header control characters.
      if (typeof contentType !== 'string' || contentType.length > 512 ||
          !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]+)?$/.test(contentType)) throw new Error('Invalid content type')
      const temp = `${path}.${randomUUID()}.pending`
      try {
        await writeFile(temp, JSON.stringify({ key, contentType, content: Buffer.concat(chunks).toString('base64') }), { flag: 'wx', mode: 0o600 })
        await rename(temp, path)
      } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error }) }
      return { key, size }
    },
    async get(key, options) {
      const range = options?.range ?? options
      if (range !== undefined && (!range || typeof range !== 'object' || Array.isArray(range))) throw new Error('Invalid range')
      const record = await stored(key)
      if (!record) return null
      const bytes = Buffer.from(record.content, 'base64')
      const offset = range?.offset ?? 0
      const length = range?.length ?? bytes.length - offset
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || (range && (offset >= bytes.length || length === 0))) throw new Error('Invalid range')
      const response = new Response(bytes.subarray(offset, offset + length))
      return { body: response.body, size: bytes.length, range: range ? { offset, length: Math.min(length, bytes.length - offset) } : null,
        httpMetadata: { contentType: record.contentType },
        writeHttpMetadata(headers) { headers.set('Content-Type', record.contentType) },
      }
    },
    async head(key) {
      const record = await stored(key)
      return record ? { size: Buffer.from(record.content, 'base64').length, httpMetadata: { contentType: record.contentType } } : null
    },
    async delete(key) { await unlink(pathFor(key)).catch(error => { if (error.code !== 'ENOENT') throw error }) },
    // Signed TUS uploads require Supabase Storage. Deliberately omit those methods
    // so recording routes report unavailable instead of claiming a fake success.
  }
}
