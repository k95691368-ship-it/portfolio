import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireLocalLock } from '../scripts/local/lock.mjs'

const directories = []
const locks = []
afterEach(async () => {
  for (const release of locks.splice(0)) await release()
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})
async function temporaryDirectory() {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'portfolio-lock-test-')))
  directories.push(path)
  return path
}
it('excludes a second owner, releases idempotently, and permits reopening', async () => {
  const path = await temporaryDirectory()
  const release = await acquireLocalLock(path)
  locks.push(release)
  await expect(acquireLocalLock(path)).rejects.toThrow('already in use')
  await release()
  await release()
  locks.push(await acquireLocalLock(path))
})
it('allows independent local data directories', async () => {
  locks.push(await acquireLocalLock(await temporaryDirectory()))
  locks.push(await acquireLocalLock(await temporaryDirectory()))
  expect(locks).toHaveLength(2)
})
