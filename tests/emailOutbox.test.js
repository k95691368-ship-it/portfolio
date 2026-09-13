import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { sqliteApp } from './helpers/sqliteApp.js'
import { sendTrackedEmail } from '../server/_lib/emailOutbox.js'

let db
const env = () => ({ DB: db, EMAIL_ENABLED: '1', GMAIL_CLIENT_ID: 'fixture', GMAIL_CLIENT_SECRET: 'fixture', GMAIL_REFRESH_TOKEN: 'fixture', FINAL_OFFER_FROM_EMAIL: 'sender@example.invalid' })
const message = { to: 'recipient@example.invalid', subject: 'Test', text: 'Test', html: '<p>Test</p>' }
const ok = (data) => Response.json(data)
beforeEach(() => { db = sqliteApp() })
afterEach(() => { db.close(); vi.unstubAllGlobals() })
it('identical content for different workflows sends independently, while retries deduplicate', async () => {
  const network = vi.fn().mockImplementation(async (url) => ok(String(url).includes('oauth2') ? { access_token: 'fixture' } : { id: 'receipt' }))
  vi.stubGlobal('fetch', network)
  for (const key of ['application:a:rejected', 'application:b:rejected', 'application:b:rejected']) {
    await sendTrackedEmail(env(), { ...message, idempotencyKey: key })
  }
  expect(db.sql.prepare('SELECT count(*) n FROM email_outbox').get().n).toBe(2)
  expect(network.mock.calls.filter(([url]) => String(url).includes('/messages/send'))).toHaveLength(2)
})
it('blocks a second send after a timeout with unknown outcome', async () => {
  const network = vi.fn().mockResolvedValueOnce(ok({ access_token: 'fixture' })).mockRejectedValueOnce(new Error('timeout'))
  vi.stubGlobal('fetch', network)
  await expect(sendTrackedEmail(env(), message)).rejects.toMatchObject({ deliveryState: 'unknown' })
  await expect(sendTrackedEmail(env(), message)).rejects.toMatchObject({ deliveryState: 'unknown' })
  expect(network).toHaveBeenCalledTimes(2)
  expect(db.sql.prepare('SELECT status FROM email_outbox').get().status).toBe('unknown')
})
it('reuses the provider receipt without sending twice', async () => {
  const network = vi.fn().mockResolvedValueOnce(ok({ access_token: 'fixture' })).mockResolvedValueOnce(ok({ id: 'receipt' }))
  vi.stubGlobal('fetch', network)
  expect(await sendTrackedEmail(env(), message)).toEqual({ id: 'receipt' })
  expect(await sendTrackedEmail(env(), message)).toEqual({ id: 'receipt' })
  expect(network).toHaveBeenCalledTimes(2)
})
it('never retries after provider acceptance and a failed database update', async () => {
  const network = vi.fn().mockResolvedValueOnce(ok({ access_token: 'fixture' })).mockResolvedValueOnce(ok({ id: 'receipt' }))
  vi.stubGlobal('fetch', network)
  const prepare = db.prepare.bind(db)
  db.prepare = (sql) => sql.includes("status = 'accepted'")
    ? { bind: () => ({ run: async () => { throw new Error('database unavailable') } }) } : prepare(sql)
  await expect(sendTrackedEmail(env(), message)).rejects.toMatchObject({ deliveryState: 'unknown' })
  await expect(sendTrackedEmail(env(), message)).rejects.toMatchObject({ deliveryState: 'unknown' })
  expect(network).toHaveBeenCalledTimes(2)
})
