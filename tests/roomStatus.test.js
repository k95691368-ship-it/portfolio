import { describe, it, expect } from 'vitest'
import { roomStatusInfo } from '../src/lib/roomStatus.js'

describe('roomStatusInfo', () => {
  it('maps each known status to a Korean label and badge class', () => {
    expect(roomStatusInfo('open').label).toBe('모집중')
    expect(roomStatusInfo('active').label).toBe('진행중')
    expect(roomStatusInfo('contract_pending').label).toBe('계약 대기')
    expect(roomStatusInfo('signed').label).toBe('계약 완료')
    expect(roomStatusInfo('signed').badgeClass).toBe('badge-success')
  })

  it('falls back to the raw status for an unknown value', () => {
    const info = roomStatusInfo('mystery')
    expect(info.label).toBe('mystery')
    expect(info.badgeClass).toBe('badge-neutral')
  })
})
