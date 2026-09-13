import { beforeEach, afterEach, it, expect, vi } from 'vitest'
vi.mock('../src/api/client.js', () => ({ api: { post: vi.fn() } }))
import { api } from '../src/api/client.js'
import { createAuthorizedChannel } from '../src/features/interview/authorizedChannel.js'

beforeEach(() => { vi.useFakeTimers(); api.post.mockReset() })
afterEach(() => vi.useRealTimers())
const credentials = { roomId: 'room', sessionId: 'session', participantId: 'server-peer' }
const response = { members: [{ participantId: 'server-peer', role: 'candidate' }], huddleActive: true, messages: [{ id: '1', payload: { from: 'host' } }] }
it('uses server presence, applies huddle before syncing peers and deduplicates messages', async () => {
  api.post.mockResolvedValue(response)
  const order = [], signal = vi.fn(), subscribed = vi.fn()
  const channel = createAuthorizedChannel(credentials)
    .on('broadcast', { event: 'huddle' }, () => order.push('huddle'))
    .on('presence', { event: 'sync' }, () => order.push('sync'))
    .on('broadcast', { event: 'signal' }, signal)
    .subscribe(subscribed)
  await vi.advanceTimersByTimeAsync(0)
  expect(order).toEqual(['huddle', 'sync'])
  expect(channel.presenceState()['server-peer'][0].role).toBe('candidate')
  await channel.track({ role: 'host' })
  await vi.advanceTimersByTimeAsync(1000)
  expect(signal).toHaveBeenCalledTimes(1)
  expect(subscribed).toHaveBeenCalledWith('SUBSCRIBED')
  expect(api.post.mock.calls[0][1]).toEqual({ action: 'heartbeat', participantId: 'server-peer' })
  await channel.unsubscribe()
})
it('closes media and clears peers after an authorization or network failure', async () => {
  api.post.mockResolvedValueOnce(response).mockRejectedValueOnce(new Error('forbidden'))
  const control = vi.fn(), status = vi.fn()
  const channel = createAuthorizedChannel(credentials).on('broadcast', { event: 'control' }, control).subscribe(status)
  await vi.advanceTimersByTimeAsync(1000)
  expect(channel.presenceState()).toEqual({})
  expect(control).toHaveBeenCalledWith({ payload: { event: 'meeting-ended' } })
  expect(status).toHaveBeenLastCalledWith('CLOSED')
  await expect(channel.send({ event: 'signal', payload: {} })).rejects.toThrow('connection_closed')
  expect(vi.getTimerCount()).toBe(0)
})
