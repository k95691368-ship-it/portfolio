import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { useContext } from 'react'
import { createMemoryRouter, RouterProvider, UNSAFE_DataRouterStateContext } from 'react-router-dom'
import { readFileSync } from 'node:fs'

vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => ({ user: null, sessionEpoch: 0 }) }))
vi.mock('../src/pages/LandingPage.jsx', () => ({ default: () => <h1>Landing page</h1> }))
vi.mock('../src/pages/LoginPage.jsx', () => ({ default: () => <h1>Login page</h1> }))
vi.mock('../src/components/ProtectedRoute.jsx', () => ({ default: () => null }))
vi.mock('../src/components/BrandLogo.jsx', () => ({ default: () => null }))
vi.mock('../src/components/PageViewTracker.jsx', () => ({ default: () => null }))
vi.mock('../src/components/DmLink.jsx', () => ({ default: () => null }))
vi.mock('../src/components/DemoMenu.jsx', () => ({ default: () => null }))
import App from '../src/App.jsx'

const routers = []
function appAt(path) {
  const router = createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: [path] })
  routers.push(router)
  return router
}
afterEach(() => {
  for (const router of routers.splice(0)) router.dispose()
})

it.each(['/unknown-route-check', '/rooms/example/not-a-page', '/unknown?token=synthetic-private-proof#synthetic-private-fragment'])('renders a safe recovery screen at %s without echoing its URL', (path) => {
  const html = renderToStaticMarkup(<RouterProvider router={appAt(path)} />)
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1]
  expect(main).toContain('<h1 id="not-found-title">페이지를 찾을 수 없습니다</h1>')
  expect(main).toMatch(/href="\/"[^>]*>처음으로<\/a>/)
  expect(main).toMatch(/href="\/jobs"[^>]*>채용 공고 보기<\/a>/)
  expect(main).not.toContain(path)
  expect(html).not.toContain('synthetic-private-proof')
  expect(html).not.toContain('synthetic-private-fragment')
})

it.each([['/', 'Landing page'], ['/login', 'Login page']])('keeps the existing %s route ahead of the fallback', (path, heading) => {
  const html = renderToStaticMarkup(<RouterProvider router={appAt(path)} />)
  expect(html).toContain(`<h1>${heading}</h1>`)
  expect(html).not.toContain('페이지를 찾을 수 없습니다')
})

it('mounts one router scroll restorer after lazy routes without replacing session or focus guards', () => {
  const source = readFileSync('src/App.jsx', 'utf8')
  expect(source.match(/<ScrollRestoration\b/g)).toHaveLength(1)
  expect(source).toMatch(/<\/Routes>[\s\S]*<ScrollRestoration storageKey="portfolio-scroll-positions"\s*\/>\s*<DeferredScrollRestoration\s*\/>\s*<\/Suspense>/)
  expect(source).toContain('<Routes key={sessionEpoch}>')
  expect(source).toContain('previousLocation.current === locationKey')
  expect(source).toContain("document.getElementById('main')?.focus({ preventScroll: true })")
  expect(source).toContain('<a href="#main" className="skip-link">')
  expect(source).not.toContain('window.scrollTo')
})

it('uses separate history positions for new navigation, Back and Forward without storing URLs', async () => {
  const router = appAt('/tech')
  const positions = {}
  let scrollY = 640
  const disable = router.enableScrollRestoration(positions, () => scrollY)
  try {
    const firstKey = router.state.location.key
    await router.navigate('/jobs?filter=example#main')
    const secondKey = router.state.location.key
    expect(positions[firstKey]).toBe(640)
    expect(router.state.restoreScrollPosition).toBeNull()
    expect(router.state.location.hash).toBe('#main')

    scrollY = 360
    await router.navigate(-1)
    expect(router.state.restoreScrollPosition).toBe(640)
    expect(positions[secondKey]).toBe(360)

    scrollY = 640
    await router.navigate(1)
    expect(router.state.restoreScrollPosition).toBe(360)

    await router.navigate('/tech') // A new visit, not Back, starts at the top.
    expect(router.state.location.key).not.toBe(firstKey)
    expect(router.state.restoreScrollPosition).toBeNull()
    expect(JSON.stringify(positions)).not.toMatch(/tech|jobs|filter|#main/)
    expect(Object.values(positions).every(value => typeof value === 'number')).toBe(true)
  } finally { disable() }
})

it('pins the installed UNSAFE router-state adapter contract for dependency upgrades', async () => {
  let observed
  function Snapshot() {
    observed = useContext(UNSAFE_DataRouterStateContext)
    return null
  }
  expect(UNSAFE_DataRouterStateContext?.Provider).toBeDefined()
  const router = createMemoryRouter([{ path: '*', element: <Snapshot /> }], { initialEntries: ['/first'] })
  routers.push(router)
  const disable = router.enableScrollRestoration({}, () => 4046)
  try {
    await router.navigate('/second')
    await router.navigate(-1)
    renderToStaticMarkup(<RouterProvider router={router} />)
    expect(observed).toBe(router.state)
    expect(observed.restoreScrollPosition).toBe(4046)
  } finally { disable() }
})
