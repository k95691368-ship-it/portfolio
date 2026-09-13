import { it, expect } from 'vitest'
import { sqliteApp } from './helpers/sqliteApp.js'
import { checkRateLimit, releaseRateLimit } from '../server/_lib/rateLimit.js'

it('admits exactly one of 20 concurrent requests; release is ticket AND bucket scoped', async () => {
  const db = sqliteApp(), env = { DB: db }
  try {
    const tickets = await Promise.all(Array.from({ length: 20 }, () => checkRateLimit(env, 'limit', 1, 60)))
    expect(tickets.filter(Boolean)).toHaveLength(1)
    const ticket = tickets.find(Boolean)
    await releaseRateLimit(env, 'other', ticket)
    expect(await checkRateLimit(env, 'limit', 1, 60)).toBe(0)
    await releaseRateLimit(env, 'limit')
    expect(await checkRateLimit(env, 'limit', 1, 60)).toBe(0)
    await releaseRateLimit(env, 'limit', ticket)
    expect(await checkRateLimit(env, 'limit', 1, 60)).toBeGreaterThan(0)
  } finally { db.close() }
})
