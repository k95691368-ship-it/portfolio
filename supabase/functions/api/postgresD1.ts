import postgres from 'npm:postgres@3.4.7'
import { normalizePostgresError, postgresQuery } from './sqlCompat.js'

type SqlClient = ReturnType<typeof postgres>

class PostgresStatement {
  database: PostgresD1
  source: string
  values: unknown[]

  constructor(database: PostgresD1, source: string, values: unknown[] = []) {
    this.database = database
    this.source = source
    this.values = values
  }

  bind(...values: unknown[]) {
    return new PostgresStatement(this.database, this.source, values)
  }

  async execute(client: SqlClient) {
    try {
      return await client.unsafe(postgresQuery(this.source), this.values)
    } catch (error) {
      throw normalizePostgresError(error)
    }
  }

  async first() {
    const rows = await this.execute(this.database.client)
    return rows[0] ?? null
  }

  async all() {
    const rows = await this.execute(this.database.client)
    return {
      success: true,
      results: [...rows],
      meta: { changes: Number(rows.count ?? 0) },
    }
  }

  async run() {
    const rows = await this.execute(this.database.client)
    return {
      success: true,
      results: [...rows],
      meta: {
        changes: Number(rows.count ?? 0),
        last_row_id: rows[0]?.id ?? null,
      },
    }
  }
}

export class PostgresD1 {
  client: SqlClient
  inTransaction: boolean

  constructor(client: SqlClient, inTransaction = false) {
    this.client = client
    this.inTransaction = inTransaction
  }

  prepare(source: string) {
    return new PostgresStatement(this, source)
  }

  async withRateLimitLock<T>(bucket: string, operation: (db: PostgresD1) => Promise<T>) {
    return this.client.begin(async (transaction) => {
      await transaction.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [bucket])
      return operation(new PostgresD1(transaction as SqlClient, true))
    })
  }

  async batch(statements: PostgresStatement[]) {
    const execute = async (transaction: SqlClient) => {
      const database = new PostgresD1(transaction as SqlClient)
      const results = []
      for (const statement of statements) {
        const rebound = new PostgresStatement(database, statement.source, statement.values)
        results.push(await rebound.run())
      }
      return results
    }
    // Scheduling wraps a multi-statement insert in a company lock transaction.
    // Keep batch rollback semantics inside it using a PostgreSQL savepoint.
    return this.inTransaction
      ? (this.client as any).savepoint(execute)
      : this.client.begin(execute)
  }
}

export function createPostgresD1(connectionString: string) {
  if (!connectionString) throw new Error('SUPABASE_DB_URL is not configured')
  const client = postgres(connectionString, {
    prepare: false,
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
  })
  return new PostgresD1(client)
}
