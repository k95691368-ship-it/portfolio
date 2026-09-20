import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { open, lstat, realpath, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises'
import { resolve, dirname, join, relative, isAbsolute, basename } from 'node:path'
import { spawn } from 'node:child_process'
import { PGlite } from '@electric-sql/pglite'

const MAGIC = Buffer.from('PRBACKUP01')
const FRAME_LIMIT = 2 * 1024 * 1024
const CHUNK = 64 * 1024
export const SQL_LIMIT = 128 * 1024 * 1024
const MAX_OBJECTS = 10000
const BUCKETS = ['documents', 'interview-recordings']
const EPHEMERAL_AUTH_TABLES = ['sessions', 'room_access_sessions', 'account_recovery_tokens',
  'application_access_tokens', 'application_access_sessions']
export class BackupError extends Error {}
const fail = (message) => { throw new BackupError(message) }
const sha = (data) => createHash('sha256').update(data).digest('hex')
const encode = (value) => Buffer.from(JSON.stringify(value))
const hasControl = (value) => Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)

export function encryptionKey(value) {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) {
    fail('BACKUP_ENCRYPTION_KEY must be a separately stored, random 32-byte hexadecimal key.')
  }
  return Buffer.from(value, 'hex')
}

export function validateObjectName(name) {
  if (typeof name !== 'string' || !name || name.length > 1024 || name.includes('\\') || hasControl(name)
    || name.split('/').some((part) => !part || part === '.' || part === '..')) fail('Invalid storage object name.')
  return name
}

function entryKey(entry) {
  if (entry?.kind === 'database' && entry.name === 'database.sql') return 'database.sql'
  if (entry?.kind !== 'object' || !BUCKETS.includes(entry.bucket)) fail('Invalid backup entry.')
  validateObjectName(entry.name)
  if (typeof entry.contentType !== 'string' || entry.contentType.length > 255 || hasControl(entry.contentType)) {
    fail('Invalid object content type.')
  }
  if (!Number.isSafeInteger(entry.expectedSize) || entry.expectedSize < 0) fail('Invalid object size.')
  return `${entry.bucket}/${entry.name}`
}

function aad(header, sequence) {
  const index = Buffer.alloc(8)
  index.writeBigUInt64BE(BigInt(sequence))
  return Buffer.concat([header, index])
}

async function readExact(file, length, position) {
  const bytes = Buffer.alloc(length)
  let read = 0
  while (read < length) {
    const result = await file.read(bytes, read, length - read, position + read)
    if (!result.bytesRead) fail('Truncated backup.')
    read += result.bytesRead
  }
  return bytes
}

// Both output types must be outside the working tree, under an existing real
// directory. Do not follow directory links, overwrite files, or use broad roots.
export async function safeNewTarget(target, { workspace = process.cwd(), suffix } = {}) {
  if (!isAbsolute(target || '')) fail('An explicit absolute output path is required.')
  const path = resolve(target)
  if (path === dirname(path) || basename(path).startsWith('.') || /[<>:"|?*]/.test(basename(path))) fail('Unsafe output path.')
  if (suffix && !path.endsWith(suffix)) fail(`Output must end with ${suffix}.`)
  const existingParent = await realpath(dirname(path))
  if (resolve(existingParent).toLowerCase() !== resolve(dirname(path)).toLowerCase()) fail('Output parent must not contain symbolic links.')
  let parent = dirname(path)
  while (parent !== dirname(parent)) {
    const stat = await lstat(parent)
    if (stat.isSymbolicLink()) fail('Output parent must not contain symbolic links.')
    parent = dirname(parent)
  }
  const root = await realpath(workspace)
  const within = relative(root.toLowerCase(), path.toLowerCase())
  if (!within || (!within.startsWith('..') && !isAbsolute(within))) fail('Backups and recovered personal data must stay outside the project working tree.')
  try { await lstat(path); fail('Output already exists; refusing to overwrite.') } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return path
}

// Each bounded frame is independently AES-GCM authenticated and bound to its
// archive and sequence. A required final manifest detects truncation, dropped
// objects, reordering and altered lengths. No unencrypted temporary dump exists.
export async function writeArchive({ output, key, metadata, entries, beforeFinish = async () => {}, workspace }) {
  const path = await safeNewTarget(output, { workspace, suffix: '.prbk' })
  const file = await open(path, 'wx', 0o600)
  const header = Buffer.concat([MAGIC, randomBytes(16)])
  let sequence = 0
  const manifest = []
  const seen = new Set()
  async function frame(type, body) {
    const plaintext = Buffer.concat([Buffer.from([type]), body])
    if (plaintext.length > FRAME_LIMIT) fail('Backup frame exceeds safety limit.')
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(aad(header, sequence++))
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const prefix = Buffer.alloc(4)
    prefix.writeUInt32BE(encrypted.length)
    await file.writeFile(Buffer.concat([prefix, nonce, cipher.getAuthTag(), encrypted]))
  }
  try {
    await file.writeFile(header)
    await frame(1, encode({ ...metadata, version: 1, scope: 'public+documents+interview-recordings' }))
    for await (const entry of entries) {
      const { body, ...description } = entry
      const name = entryKey(description)
      if (seen.has(name) || seen.size >= MAX_OBJECTS + 1) fail('Duplicate entry or too many objects.')
      seen.add(name)
      await frame(2, encode(description))
      const hash = createHash('sha256')
      let size = 0
      for await (const raw of Buffer.isBuffer(body) ? [body] : body) {
        const bytes = Buffer.from(raw)
        for (let offset = 0; offset < bytes.length; offset += CHUNK) {
          const chunk = bytes.subarray(offset, offset + CHUNK)
          size += chunk.length
          if (description.kind === 'database' && size > SQL_LIMIT) fail('Database exceeds the 128 MiB SQL restore limit.')
          hash.update(chunk)
          await frame(3, chunk)
        }
      }
      if (description.kind === 'object' && description.expectedSize !== size) fail('Object size changed during backup.')
      const result = { key: name, size, sha256: hash.digest('hex') }
      manifest.push(result)
      await frame(4, encode(result))
    }
    if (!seen.has('database.sql')) fail('Database dump is missing.')
    await beforeFinish()
    await frame(5, encode(manifest))
    await file.sync()
    await file.close()
    return { path, entries: manifest.length, objects: manifest.length - 1 }
  } catch (error) {
    await file.close().catch(() => {})
    // Only remove the exclusive file this call created, never user-owned files.
    await unlink(path).catch(() => {})
    throw error
  }
}

export async function readArchive({ input, key, collectDatabase = true, onObjectChunk, onObjectEnd }) {
  const file = await open(input, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile()) fail('Backup input must be a regular file.')
    const header = await readExact(file, MAGIC.length + 16, 0)
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) fail('Unsupported backup format.')
    let position = header.length, sequence = 0, metadata, active, hash, size = 0, finished = false
    const seen = new Set(), manifest = [], descriptions = [], sql = []
    while (position < stat.size) {
      const prefix = await readExact(file, 4, position)
      const length = prefix.readUInt32BE(0)
      if (!length || length > FRAME_LIMIT) fail('Invalid backup frame length.')
      const packet = await readExact(file, 28 + length, position + 4)
      position += 32 + length
      let plaintext
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, packet.subarray(0, 12))
        decipher.setAAD(aad(header, sequence++))
        decipher.setAuthTag(packet.subarray(12, 28))
        plaintext = Buffer.concat([decipher.update(packet.subarray(28)), decipher.final()])
      } catch { fail('Backup authentication failed: wrong key or damaged archive.') }
      const type = plaintext[0], body = plaintext.subarray(1)
      if (finished) fail('Unexpected data after final manifest.')
      if (type === 1) {
        if (metadata || sequence !== 1) fail('Invalid backup header order.')
        metadata = JSON.parse(body.toString('utf8'))
        if (metadata.version !== 1 || metadata.scope !== 'public+documents+interview-recordings') fail('Unsupported backup scope.')
      } else if (!metadata) fail('Missing archive metadata.')
      else if (type === 2) {
        if (active) fail('Unclosed backup entry.')
        active = JSON.parse(body.toString('utf8'))
        const name = entryKey(active)
        if (seen.has(name) || seen.size >= MAX_OBJECTS + 1) fail('Duplicate entry or too many objects.')
        seen.add(name)
        descriptions.push(active)
        hash = createHash('sha256'); size = 0
      } else if (type === 3) {
        if (!active) fail('Data without an entry.')
        size += body.length
        hash.update(body)
        if (active.kind === 'database') {
          if (size > SQL_LIMIT) fail('Database exceeds the 128 MiB SQL restore limit.')
          if (collectDatabase) sql.push(body)
        } else await onObjectChunk?.(active, body)
      } else if (type === 4) {
        if (!active) fail('Unexpected entry ending.')
        const expected = JSON.parse(body.toString('utf8'))
        const actual = { key: entryKey(active), size, sha256: hash.digest('hex') }
        if (JSON.stringify(expected) !== JSON.stringify(actual)) fail('Entry checksum mismatch.')
        if (active.kind === 'object' && active.expectedSize !== size) fail('Object size mismatch.')
        manifest.push(actual)
        if (active.kind === 'object') await onObjectEnd?.(active, actual)
        active = null
      } else if (type === 5) {
        if (active || !seen.has('database.sql')) fail('Incomplete archive.')
        if (JSON.stringify(JSON.parse(body.toString('utf8'))) !== JSON.stringify(manifest)) fail('Final manifest mismatch.')
        finished = true
      } else fail('Unknown backup record.')
    }
    if (!finished || active) fail('Incomplete archive; final manifest is missing.')
    return { metadata, manifest, descriptions, database: collectDatabase ? Buffer.concat(sql) : null }
  } finally { await file.close() }
}

export function localRestoreSql(buffer) {
  const sql = buffer.toString('utf8')
  // Lex rather than regex-rewrite whole lines: applicant text can itself contain
  // newlines, SQL-looking text and backslashes. Never alter a quoted data value.
  const output = []
  let index = 0, copied = 0, quote = '', escapeString = false, blockDepth = 0, dollar = ''
  while (index < sql.length) {
    const char = sql[index], next = sql[index + 1]
    if (dollar) {
      if (sql.startsWith(dollar, index)) { index += dollar.length; dollar = '' }
      else index++
    } else if (quote) {
      index++
      if (escapeString && char === '\\' && index < sql.length) { index++; continue }
      if (char === quote) {
        if (next === quote) index++
        else { quote = ''; escapeString = false }
      }
    } else if (blockDepth) {
      if (char === '/' && next === '*') { blockDepth++; index += 2 }
      else if (char === '*' && next === '/') { blockDepth--; index += 2 }
      else index++
    } else if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', index)
      if (end < 0) { index = sql.length; break }
      index = end + 1
    } else if (char === '/' && next === '*') { blockDepth = 1; index += 2 }
    else if (char === "'" || char === '"') {
      quote = char
      escapeString = char === "'" && /[eE]/.test(sql[index - 1] || '') && !/[\w$]/.test(sql[index - 2] || '')
      index++
    } else if (char === '$' && /^(?:\$\$|\$[a-zA-Z_][a-zA-Z0-9_]*\$)/.test(sql.slice(index))) {
      dollar = sql.slice(index).match(/^(?:\$\$|\$[a-zA-Z_][a-zA-Z0-9_]*\$)/)[0]
      index += dollar.length
    } else if (char === '\\') {
      const end = sql.indexOf('\n', index)
      const line = sql.slice(index, end < 0 ? sql.length : end).trimEnd()
      const prefix = sql.slice(sql.lastIndexOf('\n', index - 1) + 1, index)
      if (prefix.trim() || !/^\\(?:un)?restrict [a-zA-Z0-9]+$/.test(line)) fail('Unsupported psql commands in SQL dump.')
      output.push(sql.slice(copied, index))
      index = end < 0 ? sql.length : end
      copied = index
    } else if (char === 'C' && /^CREATE SCHEMA public;/.test(sql.slice(index)) && !/[\w$]/.test(sql[index - 1] || '')) {
      output.push(sql.slice(copied, index), 'CREATE SCHEMA IF NOT EXISTS public;')
      index += 'CREATE SCHEMA public;'.length
      copied = index
    } else index++
  }
  if (quote || dollar || blockDepth) fail('Unclosed SQL quote or comment.')
  output.push(sql.slice(copied))
  return output.join('')
}

export async function restoreDatabase(database) {
  const pg = new PGlite()
  try {
    // This app uses these Supabase roles in policies; they cannot log in here.
    await pg.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;')
    await pg.exec(localRestoreSql(database))
    // Old backups must not revive a browser session or consumed recovery link.
    // This only modifies the fresh offline instance, never the source database.
    for (const table of EPHEMERAL_AUTH_TABLES) {
      const { rows } = await pg.query('SELECT to_regclass($1) AS relation', [`public.${table}`])
      if (rows[0].relation) await pg.exec(`DELETE FROM public.${table};`)
    }
    const tables = await pg.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
    const rows = []
    for (const { tablename } of tables.rows) {
      const { rows: count } = await pg.query(`SELECT count(*)::text AS count FROM public."${tablename.replaceAll('"', '""')}"`)
      rows.push({ table: tablename, rows: count[0].count })
    }
    return { pg, rows }
  } catch {
    await pg.close().catch(() => {})
    // SQL errors may contain applicant data or hashes. Do not propagate them.
    fail('Offline PostgreSQL restore failed. Archive was not promoted; unsupported extensions or schema dependencies need review.')
  }
}

export async function verifyBackup({ input, key }) {
  const archive = await readArchive({ input, key })
  const restored = await restoreDatabase(archive.database)
  try {
    return { version: archive.metadata.version, objects: archive.manifest.length - 1,
      tables: restored.rows.length, rows: restored.rows.reduce((total, table) => total + BigInt(table.rows), 0n).toString() }
  } finally { await restored.pg.close() }
}

export async function restoreLocal({ input, output, key, confirmed, workspace }) {
  if (!confirmed) fail('Local restore requires --confirm-local-restore; recovered files contain personal data.')
  const path = await safeNewTarget(output, { workspace })
  // Complete authentication/checksums and SQL replay happen before output exists.
  const archive = await readArchive({ input, key })
  const restored = await restoreDatabase(archive.database)
  const created = [], objectFiles = new Map()
  let madeRoot = false, madeObjects = false
  try {
    await mkdir(path, { mode: 0o700 }); madeRoot = true
    await mkdir(join(path, 'objects'), { mode: 0o700 }); madeObjects = true
    const databasePath = join(path, 'database.tar.gz')
    const dump = await restored.pg.dumpDataDir('gzip')
    created.push(databasePath)
    await writeFile(databasePath, Buffer.from(await dump.arrayBuffer()), { flag: 'wx', mode: 0o600 })
    const recovered = []
    const ensureObject = async (entry) => {
      const name = entryKey(entry)
      if (!objectFiles.has(name)) {
        // Opaque filenames avoid Windows traversal, reserved names and case
        // collisions while the manifest preserves the exact bucket/object keys.
        const filename = `${sha(Buffer.from(name))}.bin`
        const full = join(path, 'objects', filename)
        const file = await open(full, 'wx', 0o600)
        created.push(full)
        objectFiles.set(name, { file, filename })
      }
      return objectFiles.get(name)
    }
    const second = await readArchive({ input, key, collectDatabase: false,
      async onObjectChunk(entry, bytes) { const object = await ensureObject(entry); await object.file.writeFile(bytes) },
      async onObjectEnd(entry, checksum) {
        const object = await ensureObject(entry)
        await object.file.close(); object.file = null
        recovered.push({ ...entry, ...checksum, file: `objects/${object.filename}` })
      },
    })
    if (JSON.stringify(second.manifest) !== JSON.stringify(archive.manifest)
      || JSON.stringify(second.metadata) !== JSON.stringify(archive.metadata)) fail('Archive changed during restore.')
    const manifestPath = join(path, 'recovery-manifest.json')
    created.push(manifestPath)
    await writeFile(manifestPath, JSON.stringify({ ...archive.metadata, tables: restored.rows,
      database: 'database.tar.gz', objects: recovered }, null, 2), { flag: 'wx', mode: 0o600 })
    return { path, tables: restored.rows.length, objects: recovered.length }
  } catch (error) {
    for (const object of objectFiles.values()) await object.file?.close().catch(() => {})
    for (const file of created.reverse()) await unlink(file).catch(() => {})
    if (madeObjects) await rmdir(join(path, 'objects')).catch(() => {})
    if (madeRoot) await rmdir(path).catch(() => {})
    throw error
  } finally { await restored.pg.close() }
}

export function sourceConfig(env) {
  let database, storage
  try { database = new URL(env.SUPABASE_DB_URL); storage = new URL(env.SUPABASE_URL) } catch {
    fail('SUPABASE_DB_URL and SUPABASE_URL must be configured.')
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname || !database.username || !database.password
    || !database.pathname.slice(1) || database.hash) fail('Invalid database connection configuration.')
  if (storage.protocol !== 'https:' || storage.username || storage.password || storage.pathname !== '/'
    || storage.search || storage.hash || !/^[a-z0-9-]+\.supabase\.co$/.test(storage.hostname)) {
    fail('SUPABASE_URL must be the HTTPS origin of the Supabase project.')
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required for private object backup.')
  const project = storage.hostname.split('.')[0]
  // Do not accidentally combine one project's database with another's storage.
  const dbUser = decodeURIComponent(database.username)
  if (database.hostname !== `db.${project}.supabase.co`
    && !(database.hostname.endsWith('.pooler.supabase.com') && dbUser.endsWith(`.${project}`))) {
    fail('Database and Storage project identities do not match.')
  }
  for (const name of database.searchParams.keys()) if (name !== 'sslmode') fail('Unsupported database URL option.')
  if (database.searchParams.has('sslmode') && !['require', 'verify-ca', 'verify-full'].includes(database.searchParams.get('sslmode'))) {
    fail('An encrypted database connection is required.')
  }
  return { project, storage: storage.origin, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    pgEnv: { PGHOST: database.hostname, PGPORT: database.port || '5432', PGDATABASE: decodeURIComponent(database.pathname.slice(1)),
      PGUSER: dbUser, PGPASSWORD: decodeURIComponent(database.password), PGSSLMODE: database.searchParams.get('sslmode') || 'require',
      PGCONNECT_TIMEOUT: '20', PGCLIENTENCODING: 'UTF8' } }
}

export async function dumpPublicDatabase(pgEnv, { spawnCommand = spawn } = {}) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('PG') && !/SECRET|TOKEN|PASSWORD|KEY|SUPABASE_DB_URL/.test(name)))
  const child = spawnCommand('pg_dump', ['--no-password', '--format=plain', '--schema=public', '--strict-names',
    '--no-owner', '--no-privileges', '--no-comments', '--no-tablespaces', '--inserts', '--rows-per-insert=1000',
    ...EPHEMERAL_AUTH_TABLES.map((table) => `--exclude-table-data=public.${table}`)],
  { shell: false, windowsHide: true, env: { ...inherited, ...pgEnv }, stdio: ['ignore', 'pipe', 'pipe'] })
  const chunks = []
  let size = 0, stderr = false, timeout = false, overLimit = false
  const timer = setTimeout(() => { timeout = true; child.kill() }, 300000)
  // Never return provider stderr: it can contain connection details or row data.
  child.stderr.on('data', () => { stderr = true })
  child.stdout.on('data', (chunk) => {
    size += chunk.length
    if (size > SQL_LIMIT) { overLimit = true; child.kill() } else chunks.push(chunk)
  })
  try {
    await new Promise((resolvePromise, reject) => {
      child.once('error', () => reject(new Error('pg_dump could not start. Install a PostgreSQL client compatible with the server.')))
      child.once('close', (code) => code === 0 && !stderr && !timeout && !overLimit
        ? resolvePromise() : reject(new Error('Database dump failed, warned, exceeded 128 MiB, or timed out. No backup was completed.')))
    })
    if (!size) fail('Database dump is empty.')
    return Buffer.concat(chunks)
  } finally { clearTimeout(timer) }
}

export function storageSource(config, fetchImpl = fetch) {
  async function request(path, options = {}) {
    let response
    try {
      response = await fetchImpl(`${config.storage}/storage/v1${path}`, { ...options, redirect: 'error',
        signal: AbortSignal.timeout(300000), headers: { apikey: config.serviceKey,
          Authorization: `Bearer ${config.serviceKey}`, 'Content-Type': 'application/json' } })
    } catch { fail('Storage network request failed; no partial backup will be accepted.') }
    if (!response.ok) { await response.body?.cancel(); fail(`Storage request failed (${response.status}); no partial backup will be accepted.`) }
    return response
  }
  async function inventory() {
    const listed = await (await request('/bucket')).json()
    if (!Array.isArray(listed)) fail('Invalid bucket inventory.')
    const buckets = [], objects = []
    for (const id of BUCKETS) {
      const bucket = listed.find((item) => item.id === id)
      if (!bucket) fail('A required application storage bucket is missing.')
      if (bucket.public !== false) fail('Application backup expects private storage buckets.')
      buckets.push({ id, public: false, file_size_limit: bucket.file_size_limit ?? null, allowed_mime_types: bucket.allowed_mime_types ?? null })
      const pending = [''], folders = new Set()
      while (pending.length) {
        const prefix = pending.pop()
        if (folders.has(prefix) || folders.size > MAX_OBJECTS) fail('Invalid or oversized folder inventory.')
        folders.add(prefix)
        for (let offset = 0; ; offset += 100) {
          if (offset > MAX_OBJECTS) fail('Storage inventory exceeds safety limit.')
          const page = await (await request(`/object/list/${id}`, { method: 'POST',
            body: JSON.stringify({ prefix, offset, limit: 100, sortBy: { column: 'name', order: 'asc' } }) })).json()
          if (!Array.isArray(page) || page.length > 100) fail('Invalid storage inventory page.')
          for (const row of page) {
            validateObjectName(row.name)
            if (row.name.includes('/')) fail('Unexpected nested name in storage listing.')
            const name = prefix ? `${prefix}/${row.name}` : row.name
            validateObjectName(name)
            if (row.id === null) { pending.push(name); continue }
            const size = row.metadata?.size
            if (typeof row.id !== 'string' || !Number.isSafeInteger(size) || size < 0) fail('Storage object metadata is incomplete.')
            objects.push({ kind: 'object', bucket: id, name, id: row.id, updatedAt: row.updated_at,
              expectedSize: size, contentType: row.metadata?.mimetype || 'application/octet-stream' })
            if (objects.length > MAX_OBJECTS) fail('Storage inventory exceeds 10000 objects.')
          }
          if (page.length < 100) break
        }
      }
    }
    objects.sort((a, b) => entryKey(a).localeCompare(entryKey(b), 'en'))
    if (new Set(objects.map(entryKey)).size !== objects.length) fail('Duplicate objects in storage inventory.')
    return { buckets, objects }
  }
  return { inventory, async download(entry) {
    entryKey(entry)
    const encoded = entry.name.split('/').map(encodeURIComponent).join('/')
    const response = await request(`/object/${entry.bucket}/${encoded}`)
    if (!response.body) fail('Storage object body is missing.')
    return response.body
  } }
}

export async function acquireBackup({ output, key, config, quiesced, source = storageSource(config), dump = dumpPublicDatabase, workspace }) {
  if (!quiesced) fail('Cross-service backup requires --confirm-quiesced after writes/uploads and retention jobs are paused.')
  // Validate the destination before reading any production personal data.
  await safeNewTarget(output, { workspace, suffix: '.prbk' })
  const initial = await source.inventory()
  const database = await dump(config.pgEnv)
  // Fail closed if the dump cannot actually restore in the bundled offline DB.
  const rehearsal = await restoreDatabase(database)
  await rehearsal.pg.close()
  async function* entries() {
    yield { kind: 'database', name: 'database.sql', body: database }
    for (const entry of initial.objects) yield { ...entry, body: await source.download(entry) }
  }
  return writeArchive({ output, key, workspace, entries: entries(),
    metadata: { createdAt: new Date().toISOString(), project: config.project, buckets: initial.buckets,
      consistency: 'operator-confirmed-quiescence-and-inventory-recheck', tables: rehearsal.rows },
    async beforeFinish() {
      if (JSON.stringify(await source.inventory()) !== JSON.stringify(initial)) fail('Storage changed during backup; retry after pausing all writes and retention.')
    },
  })
}
