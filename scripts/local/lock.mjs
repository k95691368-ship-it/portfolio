import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

// The operating system owns this handle; no PID file or stale-lock deletion can
// accidentally unlock another running database. Windows removes a pipe on exit.
export async function acquireLocalLock(canonicalDirectory) {
  const identity = process.platform === 'win32' ? canonicalDirectory.toLowerCase() : canonicalDirectory
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 32)
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\portfolio-local-${hash}` : join(canonicalDirectory, '.runtime.sock')
  const server = createServer(socket => socket.destroy())
  await new Promise((ready, reject) => {
    server.once('error', reject)
    server.listen({ path, exclusive: true, readableAll: false, writableAll: false }, ready)
  }).catch(error => {
    throw new Error(error.code === 'EADDRINUSE' ? 'This local data directory is already in use' : 'Unable to lock the local data directory', { cause: error })
  })
  server.unref()
  let closed = false
  return async () => {
    if (closed) return
    closed = true
    await new Promise((done, reject) => server.close(error => error ? reject(error) : done()))
  }
}
