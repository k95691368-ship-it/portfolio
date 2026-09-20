import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter } from 'react-router-dom'
import { shouldBlockFormNavigation } from '../src/lib/navigationGuard.js'

const routers = []
afterEach(() => routers.splice(0).forEach(router => router.dispose()))

describe('unsaved form navigation', () => {
  const here = { pathname: '/recruit', search: '', hash: '' }
  it('blocks another page or query, not a same-page anchor or a clean form', () => {
    expect(shouldBlockFormNavigation(true, here, { ...here, pathname: '/jobs' })).toBe(true)
    expect(shouldBlockFormNavigation(true, here, { ...here, search: '?draft=other' })).toBe(true)
    expect(shouldBlockFormNavigation(true, here, { ...here, hash: '#main' })).toBe(false)
    expect(shouldBlockFormNavigation(true, here, here)).toBe(false)
    expect(shouldBlockFormNavigation(false, here, { ...here, pathname: '/jobs' })).toBe(false)
  })

  function setup(entries, index) {
    const router = createMemoryRouter([{ path: '*', element: null }], { initialEntries: entries, initialIndex: index })
    routers.push(router)
    let dirty = true
    router.getBlocker('form', ({ currentLocation, nextLocation }) => shouldBlockFormNavigation(dirty, currentLocation, nextLocation))
    return { router, clean: () => { dirty = false }, blocker: () => router.state.blockers.get('form') }
  }

  it('keeps the current route on cancel and proceeds only after explicit confirmation', async () => {
    const { router, blocker, clean } = setup(['/recruit'])
    await router.navigate('/jobs')
    expect(router.state.location.pathname).toBe('/recruit')
    expect(blocker().state).toBe('blocked')
    blocker().reset()
    expect(router.state.location.pathname).toBe('/recruit')
    await router.navigate('/jobs')
    blocker().proceed()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/jobs'))
    clean()
    await router.navigate('/recruit')
    expect(router.state.location.pathname).toBe('/recruit')
    expect(blocker().state).toBe('unblocked')
  })

  it('protects both browser Back and Forward without losing the pending destination', async () => {
    const { router, blocker } = setup(['/jobs', '/recruit', '/dashboard'], 1)
    await router.navigate(-1)
    await vi.waitFor(() => expect(blocker().state).toBe('blocked'))
    expect(router.state.location.pathname).toBe('/recruit')
    expect(blocker().location.pathname).toBe('/jobs')
    blocker().reset()
    await router.navigate(1)
    await vi.waitFor(() => expect(blocker().state).toBe('blocked'))
    expect(blocker().location.pathname).toBe('/dashboard')
    blocker().proceed()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })
})
