// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile, readdir, lstat, unlink, rmdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { PGlite } from '@electric-sql/pglite'
import { encryptionKey, writeArchive, readArchive, verifyBackup, restoreLocal, safeNewTarget,
  sourceConfig, storageSource, acquireBackup, dumpPublicDatabase, validateObjectName, localRestoreSql, restoreDatabase } from '../scripts/backup-recovery-lib.mjs'
import { main } from '../scripts/backup-recovery.mjs'

const key = encryptionKey('ab'.repeat(32))
const sql = Buffer.from(`-- pg_dump-shaped public schema fixture
\\restrict Abc123
CREATE SCHEMA public;
CREATE TABLE public.applications (id text PRIMARY KEY, applicant_email text NOT NULL, answers jsonb, sequence bigint);
CREATE TABLE public.documents (id text PRIMARY KEY, application_id text REFERENCES public.applications(id), storage_key text NOT NULL);
INSERT INTO public.applications VALUES ('application-1','fixture@example.invalid','{"한글":"답변"}',9007199254740993);
INSERT INTO public.documents VALUES ('document-1','application-1','지원서/resume.pdf');
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
\\unrestrict Abc123
`)
const pdf = Buffer.from('%PDF-1.7\nfixture file\n한글\u0000binary')
const video = Buffer.alloc(300000, 43)
const entries = () => [
  { kind: 'database', name: 'database.sql', body: sql },
  { kind: 'object', bucket: 'documents', name: '지원서/resume.pdf', contentType: 'application/pdf', expectedSize: pdf.length, body: pdf },
  { kind: 'object', bucket: 'interview-recordings', name: 'rooms/recording.webm', contentType: 'video/webm', expectedSize: video.length, body: video },
  { kind: 'object', bucket: 'documents', name: 'zero.txt', contentType: 'text/plain', expectedSize: 0, body: Buffer.alloc(0) },
]

let root, archivePath, sequence = 0
const unique = (suffix = '.prbk') => join(root, `fixture-${++sequence}${suffix}`)

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'portfolio-backup-test-'))
  archivePath = unique()
  await writeArchive({ output: archivePath, key, metadata: { project: 'fixture' }, entries: entries() })
})

afterAll(async () => {
  // Only remove files under this test-created, resolved temporary directory.
  const allowed = resolve(root)
  const cleanup = async (path) => {
    const rel = relative(allowed, resolve(path))
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unsafe cleanup target')
    const stat = await lstat(path)
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const name of await readdir(path)) await cleanup(join(path, name))
      await rmdir(path)
    } else await unlink(path)
  }
  if (!allowed.startsWith(resolve(tmpdir())) || !allowed.includes('portfolio-backup-test-')) throw new Error('Unsafe test root')
  await cleanup(allowed)
})

it('encrypts SQL and object bytes and checks all streamed object checksums', async () => {
  const encrypted = await readFile(archivePath)
  expect(encrypted.includes(Buffer.from('fixture@example.invalid'))).toBe(false)
  expect(encrypted.includes(pdf)).toBe(false)
  const read = await readArchive({ input: archivePath, key })
  expect(read.database.equals(sql)).toBe(true)
  expect(read.manifest).toHaveLength(4)
  expect(read.manifest.find((entry) => entry.key === 'documents/지원서/resume.pdf')).toMatchObject({ size: pdf.length,
    sha256: createHash('sha256').update(pdf).digest('hex') })
  expect(await verifyBackup({ input: archivePath, key })).toEqual({ version: 1, objects: 3, tables: 2, rows: '2' })
}, 30000)

it('restores the actual offline PostgreSQL database plus PDF, video and empty object byte-for-byte', async () => {
  const output = unique('-recovered')
  await expect(restoreLocal({ input: archivePath, output, key, confirmed: true })).resolves.toMatchObject({ tables: 2, objects: 3 })
  const manifest = JSON.parse(await readFile(join(output, 'recovery-manifest.json'), 'utf8'))
  const recovered = new PGlite({ loadDataDir: new Blob([await readFile(join(output, manifest.database))]) })
  try {
    expect((await recovered.query('SELECT applicant_email, answers, sequence::text FROM public.applications')).rows)
      .toEqual([{ applicant_email: 'fixture@example.invalid', answers: { 한글: '답변' }, sequence: '9007199254740993' }])
    expect((await recovered.query('SELECT storage_key FROM public.documents')).rows).toEqual([{ storage_key: '지원서/resume.pdf' }])
    expect((await recovered.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.applications'::regclass")).rows[0].relrowsecurity).toBe(true)
    for (const original of entries().filter((entry) => entry.kind === 'object')) {
      const record = manifest.objects.find((entry) => entry.bucket === original.bucket && entry.name === original.name)
      const bytes = await readFile(join(output, record.file))
      // Native byte comparison avoids walking every index of a large recording
      // in the test framework while still checking its length and every byte.
      expect(bytes.equals(original.body)).toBe(true)
    }
  } finally { await recovered.close() }
}, 30000)

it.each(['wrong-key', 'tampered', 'truncated', 'extra-data', 'bad-length'])('rejects %s without creating recovered files', async (kind) => {
  let bytes = await readFile(archivePath)
  let usedKey = key
  if (kind === 'wrong-key') usedKey = encryptionKey('cd'.repeat(32))
  if (kind === 'tampered') { bytes = Buffer.from(bytes); bytes[80] ^= 1 }
  if (kind === 'truncated') bytes = bytes.subarray(0, bytes.length - 50)
  if (kind === 'extra-data') bytes = Buffer.concat([bytes, Buffer.alloc(10)])
  if (kind === 'bad-length') { bytes = Buffer.from(bytes); bytes.writeUInt32BE(0xffffffff, 26) }
  const input = unique(), output = unique('-recovered')
  await writeFile(input, bytes)
  await expect(restoreLocal({ input, output, key: usedKey, confirmed: true })).rejects.toThrow()
  await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('refuses an archive without a final authenticated manifest', async () => {
  const bytes = await readFile(archivePath)
  let offset = 26, previous = 26
  while (offset < bytes.length) { previous = offset; offset += 32 + bytes.readUInt32BE(offset) }
  const input = unique()
  await writeFile(input, bytes.subarray(0, previous))
  await expect(readArchive({ input, key })).rejects.toThrow('Incomplete archive')
})

it('binds encrypted frames to their sequence and rejects reordered chunks', async () => {
  const bytes = await readFile(archivePath)
  const first = 26, second = first + 32 + bytes.readUInt32BE(first), third = second + 32 + bytes.readUInt32BE(second)
  const input = unique()
  await writeFile(input, Buffer.concat([bytes.subarray(0, first), bytes.subarray(second, third), bytes.subarray(first, second), bytes.subarray(third)]))
  await expect(readArchive({ input, key })).rejects.toThrow('authentication failed')
})

it.each(['../escape', 'a/../escape', 'a\\escape', '/absolute', 'a//b', 'a\u0000b'])('rejects unsafe object name %j', (name) => {
  expect(() => validateObjectName(name)).toThrow()
})

it('refuses overwrite, working-tree output and unconfirmed restore', async () => {
  await expect(writeArchive({ output: archivePath, key, metadata: {}, entries: entries() })).rejects.toThrow('already exists')
  await expect(safeNewTarget(join(process.cwd(), 'private.prbk'))).rejects.toThrow('working tree')
  await expect(safeNewTarget('relative.prbk')).rejects.toThrow('absolute')
  await expect(restoreLocal({ input: archivePath, output: unique('-recovered'), key })).rejects.toThrow('confirm-local-restore')
})

it('refuses symlinked output parents when supported', async () => {
  const link = unique('-link')
  try { await symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir') } catch (error) {
    if (error.code === 'EPERM') return
    throw error
  }
  await expect(safeNewTarget(join(link, 'private.prbk'))).rejects.toThrow('symbolic links')
})

it.each(['missing-db', 'duplicate', 'wrong-size', 'source-failure'])('removes only its partial encrypted output on %s', async (kind) => {
  const output = unique()
  const source = entries()
  if (kind === 'missing-db') source.shift()
  if (kind === 'duplicate') source.push(source[1])
  if (kind === 'wrong-size') source[1].expectedSize++
  if (kind === 'source-failure') source[1].body = (async function* () { yield pdf; throw new Error('fixture download failed') })()
  await expect(writeArchive({ output, key, metadata: {}, entries: source })).rejects.toThrow()
  await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await readFile(archivePath)).subarray(0, 10).toString()).toBe('PRBACKUP01')
})

it('rejects unsupported SQL before creating any recovery directory and does not disclose SQL content', async () => {
  const input = unique(), output = unique('-recovered')
  await writeArchive({ output: input, key, metadata: {}, entries: [{ kind: 'database', name: 'database.sql',
    body: Buffer.from("SELECT 'sensitive-fixture' FROM missing_table;") }] })
  await expect(restoreLocal({ input, output, key, confirmed: true })).rejects.toThrow('Offline PostgreSQL restore failed')
  await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' })
}, 30000)

it('preserves SQL-looking applicant text, functions, comments and escape strings while removing only real psql guards', () => {
  const content = String.raw`\restrict Abc123
CREATE SCHEMA public;
INSERT INTO data VALUES ('text
CREATE SCHEMA public;
\restrict UserText
''quote''\');
SELECT $$CREATE SCHEMA public;
\i file$$;
SELECT E'escaped \' still quoted';
-- CREATE SCHEMA public;
/* CREATE SCHEMA public; /* nested */ */
\unrestrict Abc123
`
  const result = localRestoreSql(Buffer.from(content))
  expect(result).toContain('CREATE SCHEMA IF NOT EXISTS public;')
  expect(result).toContain("'text\nCREATE SCHEMA public;\n\\restrict UserText\n''quote''\\'")
  expect(result).toContain('$$CREATE SCHEMA public;\n\\i file$$')
  expect(result).toContain('-- CREATE SCHEMA public;')
  expect(result).not.toContain('\\restrict Abc123')
})

it.each(['\\! command', '\\connect another', '\\i input.sql', 'SELECT 1;\n\\copy data from stdin'])('rejects unsupported psql command %j', (command) => {
  expect(() => localRestoreSql(Buffer.from(command))).toThrow('Unsupported psql commands')
})

it('preserves account data but never revives existing login/recovery tokens during an offline restore', async () => {
  const tables = ['sessions', 'room_access_sessions', 'account_recovery_tokens', 'application_access_tokens', 'application_access_sessions']
  const credentials = tables.map((table) => `CREATE TABLE public.${table}(token_hash text); INSERT INTO public.${table} VALUES ('fixture-old-token');`).join('\n')
  const restored = await restoreDatabase(Buffer.concat([sql, Buffer.from(`\n${credentials}`)]))
  try {
    for (const table of tables) expect((await restored.pg.query(`SELECT count(*)::int AS count FROM public.${table}`)).rows).toEqual([{ count: 0 }])
    expect((await restored.pg.query('SELECT count(*)::int AS count FROM public.applications')).rows).toEqual([{ count: 1 }])
  } finally { await restored.pg.close() }
}, 30000)

const env = { BACKUP_ENCRYPTION_KEY: 'ab'.repeat(32), SUPABASE_URL: 'https://fixtureproject.supabase.co',
  SUPABASE_DB_URL: 'postgresql://postgres:fixture-password@db.fixtureproject.supabase.co:5432/postgres', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-only' }

describe('safe acquisition configuration', () => {
  it('keeps connection secrets in the subprocess environment, never arguments or URL output', () => {
    const config = sourceConfig(env)
    expect(config.pgEnv).toMatchObject({ PGSSLMODE: 'require', PGUSER: 'postgres', PGPASSWORD: 'fixture-password' })
    expect(config.project).toBe('fixtureproject')
  })
  it.each([
    { SUPABASE_URL: 'http://fixtureproject.supabase.co' },
    { SUPABASE_URL: 'https://attacker.example' },
    { SUPABASE_DB_URL: 'postgresql://postgres:fixture@db.different.supabase.co/postgres' },
    { SUPABASE_DB_URL: `${env.SUPABASE_DB_URL}?sslmode=disable` },
    { SUPABASE_DB_URL: `${env.SUPABASE_DB_URL}?options=malicious` },
    { SUPABASE_SERVICE_ROLE_KEY: '' },
  ])('rejects insecure or mismatched configuration', (override) => {
    expect(() => sourceConfig({ ...env, ...override })).toThrow()
  })
  it('preflight never sends a request and reports verification limits accurately', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Network forbidden') })
    try {
      expect(await main(['preflight'], env)).toEqual({ configurationValid: true, networkChecked: false, pgDumpChecked: false, restoreChecked: false })
      expect(network).not.toHaveBeenCalled()
      await expect(main(['create', '--password', 'fixture'], env)).rejects.toThrow('secrets')
      await expect(main(['restore-remote'], env)).rejects.toThrow('Unknown command')
    } finally { network.mockRestore() }
  })
  it('spawns pg_dump without a shell, database URI argument or prompt', async () => {
    const processStub = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
    const spawnCommand = vi.fn(() => {
      queueMicrotask(() => { processStub.stdout.write(sql); processStub.stdout.end(); processStub.emit('close', 0) })
      return processStub
    })
    expect(await dumpPublicDatabase(sourceConfig(env).pgEnv, { spawnCommand })).toEqual(sql)
    const [, argumentsList, options] = spawnCommand.mock.calls[0]
    expect(argumentsList.join(' ')).not.toContain('fixture-password')
    expect(argumentsList).toContain('--no-password')
    expect(argumentsList).toContain('--exclude-table-data=public.sessions')
    expect(argumentsList).toContain('--exclude-table-data=public.application_access_tokens')
    expect(options).toMatchObject({ shell: false, windowsHide: true })
  })
})

it('lists required private buckets recursively and downloads only from the same origin without redirects', async () => {
  const calls = []
  const network = async (url, options) => {
    calls.push([url, options])
    if (url.endsWith('/bucket')) return Response.json(['documents', 'interview-recordings'].map((id) => ({ id, public: false })))
    if (url.includes('/object/list/')) {
      const { prefix } = JSON.parse(options.body)
      if (url.endsWith('/interview-recordings')) return Response.json([])
      if (!prefix) return Response.json([{ name: '지원서', id: null }])
      return Response.json([{ name: 'resume.pdf', id: 'object-1', updated_at: '2026-09-19', metadata: { size: pdf.length, mimetype: 'application/pdf' } }])
    }
    return new Response(pdf)
  }
  const source = storageSource(sourceConfig(env), network)
  const inventory = await source.inventory()
  expect(inventory.objects).toHaveLength(1)
  expect(Buffer.from(await new Response(await source.download(inventory.objects[0])).arrayBuffer())).toEqual(pdf)
  expect(calls.every(([url, options]) => url.startsWith('https://fixtureproject.supabase.co/storage/v1/') && options.redirect === 'error')).toBe(true)
})

it.each([404, 403, 503])('fails closed when storage responds %s', async (status) => {
  const source = storageSource(sourceConfig(env), async () => new Response('fixture diagnostic', { status }))
  await expect(source.inventory()).rejects.toThrow(`Storage request failed (${status})`)
})

it('requires quiescence and aborts changed storage inventories without publishing partial backup', async () => {
  const objects = entries().filter((entry) => entry.kind === 'object').map(({ body: _body, ...description }) => description)
  const initial = { buckets: [], objects }
  const source = { inventory: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, objects: [] }),
    download: vi.fn(async (entry) => entries().find((item) => item.bucket === entry.bucket && item.name === entry.name).body) }
  const output = unique(), config = sourceConfig(env)
  await expect(acquireBackup({ output, key, config, source, dump: async () => sql })).rejects.toThrow('confirm-quiesced')
  expect(source.inventory).not.toHaveBeenCalled()
  await expect(acquireBackup({ output, key, config, source, dump: async () => sql, quiesced: true })).rejects.toThrow('Storage changed')
  await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' })
}, 30000)

it('runs the complete mocked-source acquisition and real offline SQL/files verification path', async () => {
  const objects = entries().filter((entry) => entry.kind === 'object').map(({ body: _body, ...description }) => description)
  const source = { inventory: async () => ({ buckets: [], objects }),
    download: async (entry) => entries().find((item) => item.bucket === entry.bucket && item.name === entry.name).body }
  const output = unique()
  expect(await acquireBackup({ output, key, config: sourceConfig(env), source, dump: async () => sql, quiesced: true })).toMatchObject({ objects: 3 })
  expect(await verifyBackup({ input: output, key })).toMatchObject({ tables: 2, objects: 3, rows: '2' })
}, 30000)
