import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLocalStorage } from '../scripts/local/storage.mjs'
import { createLocalMailbox, isGmailConfigured, sendGmailEmail } from '../scripts/local/mail.mjs'

const directories = []
async function directory() { const path = await mkdtemp(join(tmpdir(), 'portfolio-local-storage-test-')); directories.push(path); return path }
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }) })

it('persists exact bytes and metadata, supports partial reads, and deletes only the specified object', async () => {
  const path = await directory()
  const storage = await createLocalStorage(path)
  const bytes = new Uint8Array([0, 127, 128, 255, 1, 2])
  await storage.put('applications/example/한글.pdf', bytes, { httpMetadata: { contentType: 'application/pdf' } })
  const reopened = await createLocalStorage(path)
  const object = await reopened.get('applications/example/한글.pdf')
  expect(new Uint8Array(await new Response(object.body).arrayBuffer())).toEqual(bytes)
  expect(await reopened.head('applications/example/한글.pdf')).toEqual({ size: 6, httpMetadata: { contentType: 'application/pdf' } })
  const partial = await reopened.get('applications/example/한글.pdf', { offset: 1, length: 3 })
  expect(new Uint8Array(await new Response(partial.body).arrayBuffer())).toEqual(bytes.slice(1, 4))
  const nativePartial = await reopened.get('applications/example/한글.pdf', { range: { offset: 1, length: 3 } })
  expect(new Uint8Array(await new Response(nativePartial.body).arrayBuffer())).toEqual(bytes.slice(1, 4))
  expect(nativePartial.range).toEqual({ offset: 1, length: 3 })
  for (const range of [{ offset: -1 }, { length: 0 }, { offset: 6 }, { offset: 1.5 }]) {
    await expect(reopened.get('applications/example/한글.pdf', { range })).rejects.toThrow('Invalid range')
  }
  await reopened.delete('applications/example/missing.pdf')
  expect(await reopened.head('applications/example/한글.pdf')).not.toBeNull()
  await reopened.delete('applications/example/한글.pdf')
  expect(await reopened.get('applications/example/한글.pdf')).toBeNull()
})

it('preserves the exact contract archive MIME and bytes while rejecting header injection', async () => {
  const path = await directory()
  const storage = await createLocalStorage(path)
  const html = '<!doctype html><meta charset="utf-8"><p>검증용 계약서</p>'
  const contentType = 'text/html; charset=utf-8'
  await storage.put('contract-archives/example.html', new TextEncoder().encode(html), { httpMetadata: { contentType } })
  const document = await storage.get('contract-archives/example.html')
  const headers = new Headers()
  document.writeHttpMetadata(headers)
  expect(headers.get('Content-Type')).toBe(contentType)
  expect(await new Response(document.body).text()).toBe(html)
  await expect(storage.put('unsafe.html', html, { httpMetadata: { contentType: 'text/html;\r\nInjected: yes' } })).rejects.toThrow('Invalid content type')
  expect(await readdir(path)).toHaveLength(1)
})

it('rejects traversal and oversized streams without leaving intermediate files', async () => {
  const path = await directory()
  const storage = await createLocalStorage(path, 10)
  for (const key of ['../secret', '/absolute', 'x/../a', 'x\\y', 'x//y', 'x\ny']) {
    await expect(storage.put(key, 'data')).rejects.toThrow()
    await expect(storage.delete(key)).rejects.toThrow()
  }
  await expect(storage.put('large.pdf', new Uint8Array(11))).rejects.toThrow('size limit')
  expect(await readdir(path)).toEqual([])
})

it('captures email locally, rewrites site links to loopback, and never activates for an ordinary environment', async () => {
  const mailbox = await createLocalMailbox(await directory(), 'http://127.0.0.1:5173')
  const env = { LOCAL_ONLY: true, LOCAL_MAILBOX: mailbox }
  expect(isGmailConfigured(env)).toBe(true)
  expect(isGmailConfigured({ EMAIL_ENABLED: '1' })).toBe(false)
  const result = await sendGmailEmail(env, { to: 'test@example.invalid', subject: '<script>example</script>',
    text: 'https://portfolio-epa.pages.dev/verify-email#token=example', html: '<p>Example</p>' })
  expect(result.id).toMatch(/^local_/)
  expect(await mailbox.list()).toMatchObject([{ simulated: true, to: 'test@example.invalid', text: 'http://127.0.0.1:5173/verify-email#token=example' }])
  await expect(createLocalMailbox(await directory(), 'https://external.invalid')).rejects.toThrow('loopback')
})
