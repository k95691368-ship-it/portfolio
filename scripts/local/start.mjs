import { buildLocal } from './build.mjs'
import { startLocalRuntime } from './runtime.mjs'

try {
  await buildLocal()
  const runtime = await startLocalRuntime()
  console.log(`Local site: ${runtime.origin}`)
  console.log(`Local mailbox: ${runtime.origin}/__local/mail (no external email delivery)`)
  console.log('Local-only environment. Do not enter real personal data. Production services are not connected.')
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await runtime.close()
    process.exit(0)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
} catch {
  console.error('Local startup failed. Check the build, local database migration integrity, or port 5173 usage.')
  process.exitCode = 1
}
