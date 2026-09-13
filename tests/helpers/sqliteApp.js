import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'

export function sqliteApp() {
  const sql = new DatabaseSync(':memory:')
  sql.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    sql.exec(readFileSync(`migrations/${file}`, 'utf8'))
  }
  sql.exec(`ALTER TABLE applications ADD COLUMN consent_version TEXT;
    ALTER TABLE applications ADD COLUMN consent_snapshot TEXT;
    ALTER TABLE applications ADD COLUMN purged_at TEXT;
    ALTER TABLE applications ADD COLUMN retention_hold_reason TEXT;
    ALTER TABLE interview_recordings ADD COLUMN retention_hold_reason TEXT;
    ALTER TABLE interview_session_members ADD COLUMN signaling_seen_at TEXT;
    ALTER TABLE interview_sessions ADD COLUMN huddle_active INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE interview_signals (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, sender_id TEXT, recipient_id TEXT, payload TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE email_outbox (id TEXT PRIMARY KEY, status TEXT, provider_id TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE retention_jobs (id TEXT PRIMARY KEY, lock_token TEXT, status TEXT, attempts INTEGER, updated_at TEXT DEFAULT (datetime('now')));`)
  const db = {
    sql,
    prepare(source) {
      let values = []
      const statement = {
        source, get values() { return values },
        bind(...args) { values = args; return statement },
        async first() { return sql.prepare(source).get(...values) || null },
        async all() { return { results: sql.prepare(source).all(...values) } },
        async run() {
          const result = sql.prepare(source).run(...values)
          return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
        },
      }
      return statement
    },
    async batch(statements) {
      sql.exec('BEGIN')
      try {
        const results = []
        for (const st of statements) {
          const result = sql.prepare(st.source).run(...st.values)
          results.push({ meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } })
        }
        sql.exec('COMMIT'); return results
      } catch (error) { sql.exec('ROLLBACK'); throw error }
    },
    close() { sql.close() },
  }
  return db
}

export function seedUser(db, id, role = 'candidate', extra = {}) {
  db.sql.prepare(`INSERT INTO users (id,email,password_hash,password_salt,role,display_name,is_admin,is_recruiter)
    VALUES (?, ?, 'unused', 'unused', ?, ?, ?, ?)`)
    .run(id, extra.email || `${id}@example.invalid`, role, id, extra.admin || 0, extra.recruiter || 0)
  return db.sql.prepare('SELECT * FROM users WHERE id = ?').get(id)
}
