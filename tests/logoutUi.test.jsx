import { beforeEach, expect, it, vi } from 'vitest'

// Invoke the rendered logout button's handler with deterministic auth failures;
// dashboard data loading is not part of this test and no network is contacted.
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal(),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
  useCallback: (callback) => callback,
  useRef: (value) => ({ current: value }),
  useEffect: () => {},
}))
vi.mock('react-router-dom', () => ({ Link: 'test-link' }))
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: vi.fn() }))
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: vi.fn() }))
vi.mock('../src/api/client.js', () => ({ api: { get: vi.fn(), post: vi.fn() }, markRoomDoor: vi.fn() }))
vi.mock('../src/components/DocumentManager.jsx', () => ({ default: 'test-documents' }))
vi.mock('../src/components/NotificationBell.jsx', () => ({ default: 'test-notifications' }))
vi.mock('../src/components/MyApplications.jsx', () => ({ default: 'test-applications' }))

import { useAuth } from '../src/context/AuthContext.jsx'
import { useToast } from '../src/context/ToastContext.jsx'
import { api } from '../src/api/client.js'
import DashboardPage from '../src/pages/DashboardPage.jsx'

const nodes = (node) => !node || typeof node !== 'object' ? [] :
  Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)]
let logout, toast
const clickLogout = () => nodes(DashboardPage()).find((node) =>
  node.type === 'button' && String(node.props.children).trim() === '로그아웃'
).props.onClick()

beforeEach(() => {
  vi.resetAllMocks()
  logout = vi.fn()
  toast = { error: vi.fn(), success: vi.fn() }
  useAuth.mockReturnValue({ user: { id: 'member', role: 'company', displayName: 'Member' }, logout })
  useToast.mockReturnValue(toast)
})

it.each([0, 503])('distinguishes local logout from unconfirmed server revocation after status %i', async (status) => {
  logout.mockRejectedValueOnce(Object.assign(new Error('Sensitive upstream diagnostic'), { status }))
  await expect(clickLogout()).resolves.toBeUndefined()
  expect(logout).toHaveBeenCalledOnce()
  expect(toast.error).toHaveBeenCalledOnce()
  const message = toast.error.mock.calls[0][0]
  expect(message).toContain('이 브라우저에서는 로그아웃')
  expect(message).toContain('서버의 세션 종료 여부는 확인하지 못했습니다')
  expect(message).not.toContain('Sensitive')
  expect(toast.success).not.toHaveBeenCalled()
  expect(api.get).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
})

it('does not claim successful local logout when browser storage cannot be cleared', async () => {
  logout.mockRejectedValueOnce(Object.assign(new Error('Sensitive storage diagnostic'), { code: 'SESSION_STORAGE_CLEAR_FAILED' }))
  await expect(clickLogout()).resolves.toBeUndefined()
  const message = toast.error.mock.calls[0][0]
  expect(message).toContain('저장된 로그인 정보를 지우지 못했습니다')
  expect(message).toContain('사이트의 데이터를 삭제')
  expect(message).not.toContain('이 브라우저에서는 로그아웃했습니다')
  expect(message).not.toContain('Sensitive')
  expect(toast.success).not.toHaveBeenCalled()
})

it('does not show an obsolete logout failure after a different account logs in', async () => {
  logout.mockRejectedValueOnce(Object.assign(new Error('Stale request'), { code: 'STALE_AUTH_RESPONSE' }))
  await expect(clickLogout()).resolves.toBeUndefined()
  expect(toast.error).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
})

it('completes the logout button handler when server revocation succeeds', async () => {
  logout.mockResolvedValueOnce({ ok: true })
  await expect(clickLogout()).resolves.toBeUndefined()
  expect(logout).toHaveBeenCalledOnce()
  expect(toast.error).not.toHaveBeenCalled()
})
