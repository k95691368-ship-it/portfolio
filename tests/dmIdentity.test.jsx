import { expect, it, vi } from 'vitest'
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: vi.fn() }))
import { useAuth } from '../src/context/AuthContext.jsx'
import { DmProvider } from '../src/context/DmContext.jsx'

it('remounts private inbox state when switching accounts without logging out first', () => {
  useAuth.mockReturnValue({ user: { id: 'first' } })
  const first = DmProvider({ children: null })
  useAuth.mockReturnValue({ user: { id: 'second' } })
  const second = DmProvider({ children: null })
  expect(second.key).not.toBe(first.key)
  expect(second.props.user.id).toBe('second')
  useAuth.mockReturnValue({ user: { id: 'second', displayName: 'Updated name' } })
  expect(DmProvider({ children: null }).key).toBe(second.key)
  useAuth.mockReturnValue({ user: null })
  expect(DmProvider({ children: null }).key).toBe('guest')
})
