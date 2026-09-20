import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalDatabase, applyLocalMigrations, DEFAULT_MIGRATIONS_DIR } from '../scripts/local/database.mjs'
import { createSession, getSessionUser } from '../server/_lib/auth.js'
import { checkRateLimit } from '../server/_lib/rateLimit.js'
import { onRequestPost as publishPosting, onRequestGet as listManagedPostings } from '../server/api/postings/index.js'
import { onRequestGet as listPublicPostings } from '../server/api/jobs/index.js'

let runtime, db, blockedFetch
const insertUser = (database, id, email = `${id}@example.invalid`) => database.prepare(`INSERT INTO users
  (id,email,password_hash,password_salt,role,display_name,is_recruiter)
  VALUES (?,?,'unused','unused','company',?,1)`).bind(id, email, id)

beforeAll(async () => {
  blockedFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('External fetch is prohibited for local database tests') })
  runtime = await createLocalDatabase()
  db = runtime.db
}, 30000)

afterAll(async () => {
  try {
    await runtime?.close()
    expect(blockedFetch).not.toHaveBeenCalled()
  } finally { blockedFetch?.mockRestore() }
})

it('applies the real schema without seed accounts and explicitly skips only the remote retention schedule', async () => {
  expect(runtime.migrations.applied).toHaveLength(9)
  expect(runtime.migrations.current).toBe(10)
  expect(runtime.migrations.skipped).toEqual([{
    name: '202609130002_retention_schedule.sql', reason: expect.stringContaining('pg_cron'),
  }])
  expect(Number((await db.prepare('SELECT COUNT(*) AS n FROM users').first()).n)).toBe(0)
  const { rows: buckets } = await runtime.client.query('SELECT id, public FROM storage.buckets ORDER BY id')
  expect(buckets).toEqual([{ id: 'documents', public: false }, { id: 'interview-recordings', public: false }])
  const { rows: privateTables } = await runtime.client.query(`SELECT relname, relrowsecurity FROM pg_class
    WHERE relname IN ('users','account_recovery_tokens','application_access_sessions','posting_drafts','interview_slots')`)
  expect(privateTables).toHaveLength(5)
  expect(privateTables.every((table) => table.relrowsecurity)).toBe(true)
  for (const role of ['anon', 'authenticated']) {
    const result = await runtime.client.query("SELECT has_table_privilege($1, 'account_recovery_tokens', 'SELECT,INSERT,UPDATE,DELETE') AS allowed", [role])
    expect(result.rows[0].allowed).toBe(false)
  }
  const extensions = await runtime.client.query("SELECT to_regnamespace('cron') AS cron, to_regnamespace('net') AS net")
  expect(extensions.rows[0]).toEqual({ cron: null, net: null })
})

it('executes production session and posting handlers through the local PostgreSQL adapter', async () => {
  expect((await insertUser(db, 'local-company').run()).meta.changes).toBe(1)
  const session = await createSession(db, 'local-company', { expectedPasswordHash: 'unused' })
  const user = await getSessionUser(db, new Request('http://localhost/api/me', {
    headers: { 'X-App-Authorization': `Bearer ${session.token}` },
  }))
  expect(user).toMatchObject({ id: 'local-company', role: 'company', is_recruiter: 1 })
  const response = await publishPosting({
    env: { DB: db }, data: { user },
    request: new Request('http://localhost/api/postings', { method: 'POST', body: JSON.stringify({
      title: '로컬 검증 공고', description: '실제 PostgreSQL에 저장한 공고', deadline: '2099-12-31',
    }) }),
  })
  expect(response.status, await response.clone().text()).toBe(201)
  const { id } = await response.json()
  const publicBody = await (await listPublicPostings({ env: { DB: db } })).json()
  expect(publicBody.postings).toContainEqual(expect.objectContaining({ id, title: '로컬 검증 공고' }))
  const managedBody = await (await listManagedPostings({ env: { DB: db }, data: { user } })).json()
  expect(managedBody.postings).toContainEqual(expect.objectContaining({ id, canReuse: true }))
  await db.prepare("UPDATE job_postings SET deadline = '2000-01-01' WHERE id = ?1").bind(id).run()
  expect((await (await listPublicPostings({ env: { DB: db } })).json()).postings).toEqual([])
})

it('preserves SQL placeholders, D1 result metadata, conflict-ignore, and constraint errors', async () => {
  const statement = db.prepare('SELECT ?1::text AS first, ?2::text AS second, ?1::text AS repeated')
  expect(await statement.bind('one', 'two').first()).toEqual({ first: 'one', second: 'two', repeated: 'one' })
  expect(await statement.bind('three', 'four').first()).toEqual({ first: 'three', second: 'four', repeated: 'three' })
  expect(await db.prepare('SELECT id FROM users WHERE id = ?').bind('absent').first()).toBeNull()
  expect(await db.prepare('SELECT id FROM users WHERE id = ?').bind('local-company').all())
    .toMatchObject({ success: true, results: [{ id: 'local-company' }], meta: { changes: 1 } })
  await expect(insertUser(db, 'duplicate', 'local-company@example.invalid').run()).rejects.toThrow('UNIQUE constraint failed')
  await expect(db.prepare("INSERT INTO job_postings (id,created_by_user_id,title,description) VALUES ('orphan','absent','title','body')").run())
    .rejects.toThrow('FOREIGN KEY constraint failed')
  const ignored = await db.prepare("INSERT OR IGNORE INTO users (id,email,password_hash,password_salt,role,display_name) VALUES ('local-company','local-company@example.invalid','unused','unused','company','again')").run()
  expect(ignored.meta.changes).toBe(0)
  const hit = await db.prepare('INSERT INTO rate_limit_hits (bucket) VALUES (?)').bind('metadata').run()
  expect(hit.meta.changes).toBe(1)
  expect(Number(hit.meta.last_row_id)).toBeGreaterThan(0)
})

it('rolls back a failed batch including earlier successful writes', async () => {
  await expect(db.batch([
    insertUser(db, 'batch-rolled-back'),
    insertUser(db, 'duplicate', 'local-company@example.invalid'),
  ])).rejects.toThrow('UNIQUE constraint failed')
  expect(await db.prepare('SELECT id FROM users WHERE id = ?').bind('batch-rolled-back').first()).toBeNull()
  expect(await db.prepare('SELECT id FROM users WHERE id = ?').bind('local-company').first()).not.toBeNull()
})

it('uses a savepoint for a failed batch inside a lock and keeps the outer transaction usable', async () => {
  await db.withRateLimitLock('savepoint-proof', async (transaction) => {
    await insertUser(transaction, 'outer-before').run()
    await expect(transaction.batch([
      insertUser(transaction, 'inner-rolled-back'),
      insertUser(transaction, 'duplicate', 'local-company@example.invalid'),
    ])).rejects.toThrow('UNIQUE constraint failed')
    await transaction.batch([insertUser(db, 'outer-after')])
  })
  expect(await db.prepare('SELECT id FROM users WHERE id = ?').bind('inner-rolled-back').first()).toBeNull()
  expect((await db.prepare("SELECT id FROM users WHERE id IN ('outer-before','outer-after') ORDER BY id").all()).results)
    .toEqual([{ id: 'outer-after' }, { id: 'outer-before' }])
  await expect(db.withRateLimitLock('outer-rollback', async (transaction) => {
    await transaction.batch([insertUser(transaction, 'outer-rolled-back')])
    throw new Error('abort outer operation')
  })).rejects.toThrow('abort outer operation')
  expect(await db.prepare('SELECT id FROM users WHERE id = ?').bind('outer-rolled-back').first()).toBeNull()
})

it('serializes real rate-limit reservations and grants only one of 20 concurrent attempts', async () => {
  const tickets = await Promise.all(Array.from({ length: 20 }, () => checkRateLimit({ DB: db }, 'local-concurrent-proof', 1, 60)))
  expect(tickets.filter(Boolean)).toHaveLength(1)
  expect(Number((await db.prepare('SELECT COUNT(*) AS n FROM rate_limit_hits WHERE bucket = ?').bind('local-concurrent-proof').first()).n)).toBe(1)
})

it('reopens a persistent local database without replaying migrations or losing accounts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'portfolio-local-pg-persistence-'))
  let persistent
  try {
    const dataDir = join(directory, 'database')
    persistent = await createLocalDatabase({ dataDir })
    await insertUser(persistent.db, 'persisted').run()
    const history = (await persistent.client.query('SELECT version, checksum, applied_at FROM local_runtime.schema_migrations ORDER BY version')).rows
    await persistent.close()
    persistent = await createLocalDatabase({ dataDir })
    expect(persistent.migrations.applied).toEqual([])
    expect(await persistent.db.prepare('SELECT id FROM users WHERE id = ?').bind('persisted').first()).toEqual({ id: 'persisted' })
    expect((await persistent.client.query('SELECT version, checksum, applied_at FROM local_runtime.schema_migrations ORDER BY version')).rows).toEqual(history)
  } finally {
    await persistent?.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)

it('rejects changed, missing, duplicated, or reordered migration history and rolls back failed new migrations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'portfolio-local-pg-migrations-'))
  try {
    const migrationsDir = join(directory, 'migrations')
    await cp(DEFAULT_MIGRATIONS_DIR, migrationsDir, { recursive: true })
    const originalName = '202609190002_account_recovery.sql'
    const originalPath = join(migrationsDir, originalName)
    const original = await readFile(originalPath, 'utf8')
    await writeFile(originalPath, `${original}\n-- changed after it was applied\n`)
    await expect(applyLocalMigrations(runtime.client, { migrationsDir })).rejects.toThrow('checksum/history mismatch')
    await rm(originalPath)
    await expect(applyLocalMigrations(runtime.client, { migrationsDir })).rejects.toThrow('Previously recorded local migration is missing')
    await writeFile(originalPath, original)

    const duplicatePath = join(migrationsDir, '202609190002_duplicate.sql')
    await writeFile(duplicatePath, 'SELECT 1;')
    await expect(applyLocalMigrations(runtime.client, { migrationsDir })).rejects.toThrow('Duplicate local migration version')
    await rm(duplicatePath)

    const historicalPath = join(migrationsDir, '202609120001_late_history.sql')
    await writeFile(historicalPath, 'SELECT 1;')
    await expect(applyLocalMigrations(runtime.client, { migrationsDir })).rejects.toThrow('precedes recorded history')
    await rm(historicalPath)

    const nextPath = join(migrationsDir, '202609190005_local_failure_proof.sql')
    await writeFile(nextPath, 'BEGIN; CREATE TABLE local_failure_proof (id TEXT); INSERT INTO missing_migration_table VALUES (1); COMMIT;')
    await expect(applyLocalMigrations(runtime.client, { migrationsDir })).rejects.toThrow('Local migration failed: 202609190005_local_failure_proof.sql')
    expect((await runtime.client.query("SELECT to_regclass('public.local_failure_proof') AS name")).rows[0].name).toBeNull()
    expect(Number((await runtime.client.query('SELECT COUNT(*) AS n FROM local_runtime.schema_migrations')).rows[0].n)).toBe(10)

    await writeFile(nextPath, 'CREATE TABLE local_failure_proof (id TEXT); COMMIT; SELECT 1;')
    await expect(applyLocalMigrations(runtime.client, { migrationsDir })).rejects.toThrow('Unsupported transaction control')
    expect((await runtime.client.query("SELECT to_regclass('public.local_failure_proof') AS name")).rows[0].name).toBeNull()
    await rm(nextPath)
    expect((await applyLocalMigrations(runtime.client, { migrationsDir })).applied).toEqual([])
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 30000)

it.each(['postgres://db.example.invalid/app', 'https://db.example.invalid', 'relative/database', '\\\\server\\share\\database', '//server/share/database'])(
  'rejects a nonlocal or relative database target: %s', async (dataDir) => {
    await expect(createLocalDatabase({ dataDir })).rejects.toThrow('absolute local filesystem directory')
  },
)
