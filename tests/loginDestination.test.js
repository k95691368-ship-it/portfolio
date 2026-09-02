import { describe, expect, it } from 'vitest'
import {
  loginDestination,
  requiresFreshDocument,
} from '../src/lib/loginDestination.js'

describe('로그인 뒤 화상 면접 복귀 주소', () => {
  it('화상 면접 내부 주소만 허용한다', () => {
    expect(
      loginDestination('?next=%2Frooms%2Froom-1%2Finterview%2Fsession-1')
    ).toBe('/rooms/room-1/interview/session-1')
  })

  it('외부·다른 내부 주소는 대시보드로 보낸다', () => {
    expect(loginDestination('?next=https%3A%2F%2Fevil.example')).toBe('/dashboard')
    expect(loginDestination('?next=%2F%2Fevil.example')).toBe('/dashboard')
    expect(loginDestination('?next=%2Fadmin')).toBe('/dashboard')
  })

  it('화상 면접 복귀만 새 문서 탐색 대상으로 구분한다', () => {
    expect(requiresFreshDocument('/rooms/room-1/interview/session-1')).toBe(true)
    expect(requiresFreshDocument('/dashboard')).toBe(false)
    expect(requiresFreshDocument('//evil.example/interview/session-1')).toBe(false)
  })
})
