import { readFile, writeFile } from 'node:fs/promises'

const [source = '.tmp-d1-export.sql', target = '.tmp-supabase-data.sql'] = process.argv.slice(2)
const dump = await readFile(source, 'utf8')

const byTable = new Map()
for (const line of dump.split(/\r?\n/)) {
  const match = line.match(/^INSERT INTO\s+"?([A-Za-z0-9_]+)"?\s*(?:\([^)]*\)\s*)?VALUES\b/i)
  if (!match || ['d1_migrations', 'sqlite_sequence'].includes(match[1])) continue
  const rows = byTable.get(match[1]) ?? []
  rows.push(
    line
      .replace(/^INSERT INTO\s+"?([A-Za-z0-9_]+)"?/i, 'INSERT INTO $1')
      .replace(/\bchar\(10\)/gi, 'chr(10)')
  )
  byTable.set(match[1], rows)
}

const preferredOrder = [
  'users',
  'sessions',
  'interview_rooms',
  'room_participants',
  'job_postings',
  'applications',
  'application_documents',
  'interview_sessions',
  'interview_session_members',
  'interview_recording_consents',
  'interview_recordings',
  'interview_events',
  'recording_access_logs',
  'chat_messages',
  'documents',
  'contract_terms',
  'signatures',
  'rate_limit_hits',
  'admin_audit_log',
  'contract_edit_history',
  'final_offer_emails',
  'signed_contracts',
  'notifications',
  'contract_change_requests',
  'contract_translations',
  'interview_summaries',
  'signature_revocations',
  'contract_deliveries',
  'audit_certificates',
  'room_lifecycle_log',
  'negotiation_log',
  'room_access_sessions',
  'push_subscriptions',
  'direct_messages',
  'contract_archive',
]

const remaining = [...byTable.keys()].filter((table) => !preferredOrder.includes(table)).sort()
const order = [...preferredOrder, ...remaining]
const identityTables = [
  'chat_messages',
  'rate_limit_hits',
  'admin_audit_log',
  'contract_edit_history',
  'notifications',
  'signature_revocations',
  'room_lifecycle_log',
  'negotiation_log',
  'direct_messages',
]

const output = [
  '-- One-time data transfer generated from the private D1 export.',
  'BEGIN;',
  "SET LOCAL session_replication_role = 'replica';",
]

for (const table of order) {
  const rows = byTable.get(table)
  if (!rows?.length) continue
  output.push(`\n-- ${table}: ${rows.length} row(s)`, ...rows)
}

output.push("\nSET LOCAL session_replication_role = 'origin';")
for (const table of identityTables) {
  output.push(
    `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT COUNT(*) > 0 FROM ${table}));`
  )
}
output.push('COMMIT;', '')

await writeFile(target, output.join('\n'))
console.log(`${target}: ${[...byTable.values()].reduce((sum, rows) => sum + rows.length, 0)} row(s)`)
