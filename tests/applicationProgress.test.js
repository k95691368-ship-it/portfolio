import { describe, it, expect } from 'vitest'
import {
  describeApplicationProgress,
  sortMyApplications,
  STEP_KEYS,
} from '../functions/_lib/applicationProgress.js'

function stateOf(progress, key) {
  return progress.steps.find((s) => s.key === key).state
}

describe('describeApplicationProgress', () => {
  it('접수 직후에는 첫 단계에 머문다', () => {
    const p = describeApplicationProgress({ status: 'submitted', createdAt: '2026-07-01' })
    expect(p.reached).toBe(0)
    expect(stateOf(p, 'submitted')).toBe('current')
    expect(stateOf(p, 'screened')).toBe('upcoming')
    expect(p.headline).toContain('검토')
    expect(p.link).toBeNull()
  })

  it('서류합격했지만 아직 면접방이 없으면 심사 단계', () => {
    const p = describeApplicationProgress({
      status: 'passed',
      createdAt: '2026-07-01',
      reviewedAt: '2026-07-05',
    })
    expect(p.reached).toBe(1)
    expect(stateOf(p, 'submitted')).toBe('done')
    expect(stateOf(p, 'screened')).toBe('current')
    expect(p.headline).toContain('면접방 안내')
  })

  it('면접방이 열리면 면접 단계로 넘어간다', () => {
    const p = describeApplicationProgress({
      status: 'passed',
      roomId: 'room-1',
      roomStatus: 'open',
    })
    expect(p.reached).toBe(2)
    expect(stateOf(p, 'interview')).toBe('current')
    expect(p.link).toBe('/rooms/room-1')
    expect(p.linkLabel).toBe('면접방 들어가기')
  })

  it('채용이 확정되면 계약서로 바로 이어준다', () => {
    const p = describeApplicationProgress({
      status: 'passed',
      roomId: 'room-1',
      roomStatus: 'contract_pending',
    })
    expect(p.reached).toBe(2)
    expect(p.link).toBe('/rooms/room-1/contract')
    expect(p.linkLabel).toContain('서명')
    expect(p.headline).toContain('채용이 확정')
  })

  it('체결이 끝나면 마지막 단계에 도달한다', () => {
    const p = describeApplicationProgress({
      status: 'passed',
      roomId: 'room-1',
      roomStatus: 'signed',
      signedAt: '2026-08-01',
    })
    expect(p.reached).toBe(3)
    expect(stateOf(p, 'contract')).toBe('current')
    expect(p.steps.find((s) => s.key === 'contract').at).toBe('2026-08-01')
    expect(p.linkLabel).toContain('체결된 계약서')
  })

  it('불합격은 심사 단계에서 멈춘 것으로 표시한다', () => {
    const p = describeApplicationProgress({
      status: 'rejected',
      createdAt: '2026-07-01',
      reviewedAt: '2026-07-05',
    })
    expect(stateOf(p, 'submitted')).toBe('done')
    expect(stateOf(p, 'screened')).toBe('stopped')
    expect(stateOf(p, 'interview')).toBe('upcoming')
    expect(p.link).toBeNull()
    expect(p.headline).toContain('함께하지 못하게')
  })

  it('단계는 언제나 네 개다', () => {
    const p = describeApplicationProgress({ status: 'submitted' })
    expect(p.steps.map((s) => s.key)).toEqual(STEP_KEYS)
  })

  it('값이 없어도 무너지지 않는다', () => {
    const p = describeApplicationProgress(null)
    expect(p.reached).toBe(0)
    expect(p.steps).toHaveLength(4)
  })
})

describe('sortMyApplications', () => {
  it('진행 중인 것을 먼저, 끝난 것을 뒤로 보낸다', () => {
    const sorted = sortMyApplications([
      { id: 'rejected', status: 'rejected', createdAt: '2026-07-10' },
      { id: 'signed', status: 'passed', roomId: 'r', roomStatus: 'signed', createdAt: '2026-07-09' },
      { id: 'waiting', status: 'submitted', createdAt: '2026-07-08' },
      { id: 'interview', status: 'passed', roomId: 'r2', roomStatus: 'open', createdAt: '2026-07-07' },
    ])
    expect(sorted.map((s) => s.id)).toEqual(['interview', 'waiting', 'signed', 'rejected'])
  })

  it('같은 단계면 최근 지원이 앞선다', () => {
    const sorted = sortMyApplications([
      { id: 'old', status: 'submitted', createdAt: '2026-07-01' },
      { id: 'new', status: 'submitted', createdAt: '2026-07-20' },
    ])
    expect(sorted.map((s) => s.id)).toEqual(['new', 'old'])
  })

  it('빈 목록도 처리한다', () => {
    expect(sortMyApplications([])).toEqual([])
    expect(sortMyApplications(null)).toEqual([])
  })
})
