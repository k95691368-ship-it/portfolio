import { pathToFileURL } from 'node:url'
import { BackupError, encryptionKey, sourceConfig, acquireBackup, verifyBackup, restoreLocal } from './backup-recovery-lib.mjs'

const HELP = `Encrypted hiring-platform backup (no remote restore or scheduler).

node scripts/backup-recovery.mjs preflight
node scripts/backup-recovery.mjs create --output <absolute-path.prbk> --confirm-quiesced
node scripts/backup-recovery.mjs verify --input <absolute-path.prbk>
node scripts/backup-recovery.mjs restore-local --input <absolute-path.prbk> --output <new-absolute-directory> --confirm-local-restore

Credentials only through environment: SUPABASE_DB_URL, SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY, BACKUP_ENCRYPTION_KEY (random 32-byte hex).
Keep the encryption key separately from the backup; losing it prevents recovery.
create needs pg_dump on PATH compatible with the server, plus paused application
writes/uploads AND retention jobs. This command does not pause them for you.
Scope: public application schema/data + documents and interview-recordings object
bytes and bucket settings. Excludes platform auth, Edge secrets/config, role grants,
and Supabase internal schemas. Login sessions and account/application recovery
tokens are excluded (schemas preserved); restored users must authenticate anew.
Max SQL dump 128 MiB; max 10000 storage objects.
Objects are streamed. Large recordings do not have to fit in memory.
verify replays SQL in isolated in-memory PostgreSQL and checks every object hash.
restore-local authenticates and replays first, then creates a NEW offline PGlite
database.tar.gz, object files and a recovery manifest outside the project tree.
These recovered files are PLAINTEXT personal data; choose a private local folder.
Nothing uploads data, sends email, overwrites an existing target or restores to a
remote database. Production restoration requires a separate reviewed runbook.
`

export async function main(args, env = process.env) {
  if (!args.length || args[0] === '--help') return { help: HELP }
  const [command, ...rest] = args
  if (!['preflight', 'create', 'verify', 'restore-local'].includes(command)) throw new Error('Unknown command; use --help.')
  const options = {}
  for (let i = 0; i < rest.length; i++) {
    const option = rest[i]
    if (!['--input', '--output', '--confirm-quiesced', '--confirm-local-restore'].includes(option) || options[option] !== undefined) {
      throw new Error('Unknown or repeated option; secrets must never be passed on the command line.')
    }
    if (option.startsWith('--confirm-')) options[option] = true
    else if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('Missing path argument.')
    else options[option] = rest[++i]
  }
  const key = encryptionKey(env.BACKUP_ENCRYPTION_KEY)
  if (command === 'preflight') {
    sourceConfig(env)
    return { configurationValid: true, networkChecked: false, pgDumpChecked: false, restoreChecked: false }
  }
  if (command === 'create') return acquireBackup({ output: options['--output'], key, config: sourceConfig(env), quiesced: options['--confirm-quiesced'] })
  if (!options['--input']) throw new Error('--input is required.')
  if (command === 'verify') return verifyBackup({ input: options['--input'], key })
  return restoreLocal({ input: options['--input'], output: options['--output'], key, confirmed: options['--confirm-local-restore'] })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await main(process.argv.slice(2))
    console.log(result.help || JSON.stringify(result))
  } catch (error) {
    // Raw SQL/provider/OS errors can contain secrets or private object paths.
    console.error(error instanceof BackupError ? error.message
      : 'Backup command failed; no success is claimed. Check --help, required environment, target permissions, pg_dump and quiescence. Existing backups are never overwritten.')
    process.exitCode = 1
  }
}
