import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { normalizePostgresError, postgresQuery } from '../../supabase/functions/api/sqlCompat.js'

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
export const LOCAL_SKIPPED_MIGRATIONS = Object.freeze({
  '202609130002_retention_schedule.sql': 'Local PGlite has no pg_cron, pg_net, or Supabase Vault; the remote retention schedule is disabled.',
})

const BOOTSTRAP_SQL = `
  DO $local_roles$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      CREATE ROLE authenticated NOLOGIN;
    END IF;
  END
  $local_roles$;
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE IF NOT EXISTS storage.buckets (
    id TEXT PRIMARY KEY, name TEXT, public BOOLEAN, file_size_limit BIGINT
  );
  CREATE SCHEMA IF NOT EXISTS local_runtime;
  CREATE TABLE IF NOT EXISTS local_runtime.schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    checksum TEXT NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
    disposition TEXT NOT NULL CHECK (disposition IN ('applied', 'skipped')),
    reason TEXT,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  REVOKE ALL ON SCHEMA local_runtime FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON ALL TABLES IN SCHEMA local_runtime FROM PUBLIC, anon, authenticated;
`

// Split only at SQL statement boundaries. Procedure bodies, quoted text, and
// comments may contain semicolons or BEGIN/COMMIT without controlling a transaction.
function migrationStatements(source) {
  const statements = []
  let start = 0
  let command = ''
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (source.startsWith('--', index)) {
      const end = source.indexOf('\n', index + 2)
      index = end === -1 ? source.length : end
      command += ' '
      continue
    }
    if (source.startsWith('/*', index)) {
      let depth = 1
      index += 2
      while (index < source.length && depth) {
        if (source.startsWith('/*', index)) { depth += 1; index += 2 }
        else if (source.startsWith('*/', index)) { depth -= 1; index += 2 }
        else index += 1
      }
      index -= 1
      command += ' '
      continue
    }
    if (char === "'" || char === '"') {
      const escaped = char === "'" && /[eE]/.test(source[index - 1] || '') && !/[\w$]/.test(source[index - 2] || '')
      index += 1
      while (index < source.length) {
        if (escaped && source[index] === '\\') index += 2
        else if (source[index] !== char) index += 1
        else if (source[index + 1] === char) index += 2
        else break
      }
      command += ' quoted '
      continue
    }
    if (char === '$') {
      const delimiter = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0]
      if (delimiter) {
        const end = source.indexOf(delimiter, index + delimiter.length)
        index = end === -1 ? source.length : end + delimiter.length - 1
        command += ' quoted '
        continue
      }
    }
    if (char === ';') {
      if (command.trim()) statements.push({ source: source.slice(start, index + 1), command: command.trim().replace(/\s+/g, ' ').toUpperCase() })
      start = index + 1
      command = ''
    } else command += char
  }
  if (command.trim()) statements.push({ source: source.slice(start), command: command.trim().replace(/\s+/g, ' ').toUpperCase() })
  return statements
}

function migrationBody(source, name) {
  const statements = migrationStatements(source)
  const begins = /^(?:BEGIN(?: WORK| TRANSACTION)?|START TRANSACTION)$/
  const commits = /^(?:COMMIT|END)(?: WORK| TRANSACTION)?$/
  if (begins.test(statements[0]?.command || '') && commits.test(statements.at(-1)?.command || '')) {
    statements.shift()
    statements.pop()
  }
  // The runner owns the transaction, including its migration ledger update.
  // Unsupported transaction control must never commit a partially applied schema.
  if (statements.some(({ command }) => /^(?:BEGIN|START TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE TRANSACTION)\b/.test(command))) {
    throw new Error(`Unsupported transaction control in local migration: ${name}`)
  }
  return statements.map((statement) => statement.source).join('\n')
}

async function readMigrations(migrationsDir) {
  const entries = await readdir(migrationsDir, { withFileTypes: true })
  const names = entries.filter((entry) => entry.name.endsWith('.sql')).map((entry) => {
    if (!entry.isFile() || !/^\d+_[A-Za-z0-9_-]+\.sql$/.test(entry.name)) {
      throw new Error(`Invalid local migration file: ${entry.name}`)
    }
    return entry.name
  }).sort((left, right) => {
    const a = BigInt(left.split('_')[0]), b = BigInt(right.split('_')[0])
    return a < b ? -1 : a > b ? 1 : left.localeCompare(right)
  })
  if (!names.length) throw new Error('No local SQL migrations were found')
  const versions = new Set()
  const migrations = []
  for (const name of names) {
    const version = BigInt(name.split('_')[0]).toString()
    if (versions.has(version)) throw new Error(`Duplicate local migration version: ${version}`)
    versions.add(version)
    const source = await readFile(join(migrationsDir, name), 'utf8')
    const reason = LOCAL_SKIPPED_MIGRATIONS[name] || null
    migrations.push({
      version, name, reason,
      disposition: reason ? 'skipped' : 'applied',
      checksum: createHash('sha256').update(source).digest('hex'),
      sql: reason ? '' : migrationBody(source, name),
    })
  }
  return migrations
}

/** Apply actual project migrations atomically; changed or missing history stops startup. */
export async function applyLocalMigrations(client, { migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  const migrations = await readMigrations(migrationsDir)
  return client.transaction(async (transaction) => {
    await transaction.exec(BOOTSTRAP_SQL)
    const { rows: history } = await transaction.query('SELECT version, name, checksum, disposition FROM local_runtime.schema_migrations')
    const byVersion = new Map(migrations.map((migration) => [migration.version, migration]))
    const previous = new Set(history.map((migration) => migration.version))
    let latest = -1n
    for (const recorded of history) {
      const expected = byVersion.get(recorded.version)
      if (!expected) throw new Error(`Previously recorded local migration is missing: ${recorded.name}`)
      if (expected.name !== recorded.name || expected.checksum !== recorded.checksum || expected.disposition !== recorded.disposition) {
        throw new Error(`Previously recorded local migration changed (checksum/history mismatch): ${recorded.name}`)
      }
      if (BigInt(recorded.version) > latest) latest = BigInt(recorded.version)
    }
    for (const migration of migrations) {
      if (!previous.has(migration.version) && BigInt(migration.version) < latest) {
        throw new Error(`New local migration precedes recorded history: ${migration.name}`)
      }
    }

    const applied = []
    for (const migration of migrations) {
      if (previous.has(migration.version)) continue
      try {
        if (migration.sql.trim()) await transaction.exec(migration.sql)
        await transaction.query(`INSERT INTO local_runtime.schema_migrations
          (version, name, checksum, disposition, reason) VALUES ($1, $2, $3, $4, $5)`,
        [migration.version, migration.name, migration.checksum, migration.disposition, migration.reason])
      } catch (error) {
        throw new Error(`Local migration failed: ${migration.name}`, { cause: error })
      }
      if (migration.disposition === 'applied') applied.push(migration.name)
    }
    return {
      applied,
      skipped: migrations.filter((migration) => migration.reason).map(({ name, reason }) => ({ name, reason })),
      current: migrations.length,
    }
  })
}

class LocalPostgresStatement {
  constructor(database, source, values = []) {
    this.database = database
    this.source = source
    this.values = values
  }

  bind(...values) { return new LocalPostgresStatement(this.database, this.source, values) }

  async execute() {
    try { return await this.database.client.query(postgresQuery(this.source), this.values) }
    catch (error) { throw normalizePostgresError(error) }
  }

  async first() {
    return (await this.execute()).rows[0] ?? null
  }

  async all() {
    const result = await this.execute()
    return { success: true, results: result.rows, meta: { changes: Number(result.rowCount ?? result.affectedRows ?? result.rows.length) } }
  }

  async run() {
    const result = await this.execute()
    return {
      success: true,
      results: result.rows,
      meta: { changes: Number(result.rowCount ?? result.affectedRows ?? result.rows.length), last_row_id: result.rows[0]?.id ?? null },
    }
  }
}

/** D1-shaped adapter over a local PGlite instance; shares production SQL normalization. */
export class LocalPostgresD1 {
  constructor(client, inTransaction = false, context = { savepoint: 0 }) {
    this.client = client
    this.inTransaction = inTransaction
    this.context = context
  }

  prepare(source) { return new LocalPostgresStatement(this, source) }

  async transaction(operation) {
    if (!this.inTransaction) {
      return this.client.transaction((transaction) => operation(new LocalPostgresD1(transaction, true, this.context)))
    }
    const name = `local_batch_${++this.context.savepoint}`
    await this.client.query(`SAVEPOINT ${name}`)
    try {
      const result = await operation(new LocalPostgresD1(this.client, true, this.context))
      await this.client.query(`RELEASE SAVEPOINT ${name}`)
      return result
    } catch (error) {
      await this.client.query(`ROLLBACK TO SAVEPOINT ${name}`)
      await this.client.query(`RELEASE SAVEPOINT ${name}`)
      throw error
    }
  }

  async withRateLimitLock(bucket, operation) {
    return this.transaction(async (database) => {
      await database.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [bucket])
      return operation(database)
    })
  }

  async batch(statements) {
    if (!Array.isArray(statements) || statements.some((statement) => !(statement instanceof LocalPostgresStatement) || statement.database.context !== this.context)) {
      throw new TypeError('Local database batches require statements from this database')
    }
    return this.transaction(async (database) => {
      const results = []
      for (const statement of statements) {
        results.push(await new LocalPostgresStatement(database, statement.source, statement.values).run())
      }
      return results
    })
  }
}

function localDataDirectory(dataDir) {
  if (dataDir === ':memory:' || dataDir === 'memory://') return undefined
  if (typeof dataDir !== 'string' || !isAbsolute(dataDir) || /^[\\/]{2}/.test(dataDir) || dataDir.includes('\0')) {
    throw new TypeError('Local PGlite dataDir must be :memory: or an absolute local filesystem directory; connection URLs and network shares are not accepted')
  }
  return resolve(dataDir)
}

/** No remote connection settings, seeded accounts, extension downloads, or fetch calls. */
export async function createLocalDatabase({ dataDir = ':memory:', migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  const client = new PGlite(localDataDirectory(dataDir))
  try {
    await client.waitReady
    const migrations = await applyLocalMigrations(client, { migrationsDir })
    return {
      db: new LocalPostgresD1(client),
      client,
      migrations,
      async close() { if (!client.closed) await client.close() },
    }
  } catch (error) {
    await client.close().catch(() => {})
    throw error
  }
}
