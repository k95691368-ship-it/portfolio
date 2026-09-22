import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync('public/sw.js', 'utf8')
const origin = 'https://portfolio-epa.pages.dev'

function worker(windows = []) {
  const listeners = {}
  const self = {
    location: { origin },
    addEventListener: (type, listener) => { listeners[type] = listener },
    registration: { showNotification: vi.fn().mockResolvedValue(undefined) },
    clients: { matchAll: vi.fn().mockResolvedValue(windows), openWindow: vi.fn().mockResolvedValue({}) },
  }
  runInNewContext(source, { self, URL })
  async function fire(type, event) {
    const pending = []
    listeners[type]({ ...event, waitUntil: (promise) => pending.push(promise) })
    await Promise.all(pending)
  }
  const click = (url) => fire('notificationclick', { notification: { close: vi.fn(), data: { url } } })
  return { self, fire, click }
}

describe('service worker notification navigation', () => {
  it.each([
    'https://outside.invalid/phishing', '//outside.invalid/phishing', 'javascript:alert(1)',
    'data:text/html,test', 'https://portfolio-epa.pages.dev@outside.invalid/',
    'https://name:password@portfolio-epa.pages.dev/', '/\\outside.invalid/',
    '\nhttps://outside.invalid/', 'https://portfolio-epa.pages.dev:444/', 123, null, {},
  ])('rejects unsafe destinations on both arrival and click: %j', async (url) => {
    const { self, fire, click } = worker()
    await fire('push', { data: { json: () => ({ title: '알림', url }) } })
    expect(self.registration.showNotification.mock.calls[0][1].data.url).toBe(`${origin}/`)
    await click(url)
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${origin}/`)
  })

  it.each(['/rooms/abc?view=chat#latest', `${origin}/recruit`])('preserves valid internal destinations: %s', async (url) => {
    const { self, click } = worker()
    await click(url)
    expect(self.clients.openWindow).toHaveBeenCalledWith(new URL(url, origin).href)
  })

  it.each([null, [], 1, 'message', { title: {}, body: 42, tag: [] }])('handles malformed payloads without losing the notification: %j', async (payload) => {
    const { self, fire } = worker()
    await fire('push', { data: { json: () => payload } })
    expect(self.registration.showNotification).toHaveBeenCalledWith('새 메시지', expect.objectContaining({
      body: '면접방에 새 메시지가 도착했습니다.', tag: 'room-message', data: { url: `${origin}/` },
    }))
  })

  it('handles invalid JSON and missing push data', async () => {
    const { self, fire } = worker()
    await fire('push', { data: { json: () => { throw new Error('Invalid JSON') } } })
    await fire('push', {})
    expect(self.registration.showNotification).toHaveBeenCalledTimes(2)
  })

  it('waits for an existing tab to navigate before focusing it', async () => {
    let finishNavigation
    const focused = { focus: vi.fn().mockResolvedValue(undefined) }
    const tab = { url: `${origin}/`, focus: vi.fn(), navigate: vi.fn(() => new Promise((resolve) => { finishNavigation = resolve })) }
    const { self, click } = worker([tab])
    const pending = click('/rooms/abc')
    await vi.waitFor(() => expect(tab.navigate).toHaveBeenCalledWith(`${origin}/rooms/abc`))
    expect(focused.focus).not.toHaveBeenCalled()
    finishNavigation(focused)
    await pending
    expect(focused.focus).toHaveBeenCalledTimes(1)
    expect(self.clients.openWindow).not.toHaveBeenCalled()
  })

  it('focuses an already matching tab without navigating again', async () => {
    const tab = { url: `${origin}/rooms/abc`, focus: vi.fn().mockResolvedValue(undefined), navigate: vi.fn() }
    const { self, click } = worker([tab])
    await click('/rooms/abc')
    expect(tab.focus).toHaveBeenCalledTimes(1)
    expect(tab.navigate).not.toHaveBeenCalled()
    expect(self.clients.openWindow).not.toHaveBeenCalled()
  })

  it.each(['closed', 'null'])('opens a new tab if an existing tab cannot be navigated (%s)', async (failure) => {
    const tab = { focus: vi.fn(), navigate: failure === 'closed' ? vi.fn().mockRejectedValue(new Error('Closed')) : vi.fn().mockResolvedValue(null) }
    const { self, click } = worker([tab])
    await click('/rooms/abc')
    expect(self.clients.openWindow).toHaveBeenCalledWith(`${origin}/rooms/abc`)
  })
})
