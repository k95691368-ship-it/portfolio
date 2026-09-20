// This module is aliased ONLY in the offline server bundle, never in production.
import { randomUUID } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { privateDirectory } from './storage.mjs'

export class EmailDeliveryError extends Error {
  constructor(message, deliveryState = 'failed') { super(message); this.name = 'EmailDeliveryError'; this.deliveryState = deliveryState }
}

export function isGmailConfigured(env) { return env.LOCAL_ONLY === true && typeof env.LOCAL_MAILBOX?.send === 'function' }
export function sendGmailEmail(env, message) {
  if (!isGmailConfigured(env)) throw new EmailDeliveryError('Offline mailbox is not available')
  return env.LOCAL_MAILBOX.send(message)
}

export async function createLocalMailbox(directory, origin) {
  const root = await privateDirectory(directory)
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Mailbox links require the exact loopback origin')
  return {
    async send(message) {
      if (typeof message.to !== 'string' || /[\r\n]/.test(message.to) || !message.to.includes('@')) throw new EmailDeliveryError('Invalid recipient')
      const id = `local_${randomUUID()}`
      // Links remain actionable locally; the original production email builder
      // is exercised unchanged. No HTML is executed by the mailbox viewer.
      const rewrite = value => String(value || '').replaceAll('https://portfolio-epa.pages.dev', origin)
      const row = { id, createdAt: new Date().toISOString(), to: message.to, subject: String(message.subject || ''),
        text: rewrite(message.text), html: rewrite(message.html), attachmentCount: message.attachments?.length || 0,
        simulated: true }
      await writeFile(join(root, `${id}.json`), JSON.stringify(row), { flag: 'wx', mode: 0o600 })
      return { id }
    },
    async list() {
      const files = (await readdir(root)).filter(name => /^local_[a-f0-9-]+\.json$/.test(name))
      const rows = await Promise.all(files.map(async name => JSON.parse(await readFile(join(root, name), 'utf8'))))
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
  }
}
