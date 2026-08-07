// 전형을 끝냈다고 말할 수 있는가.
//
// 닫을 수 없으면 다른 사람을 뽑아 끝난 전형이 지원자 화면에 "진행중"으로 남고,
// 지원자는 아직 검토 중이라고 믿고 기다린다. 더 위험한 쪽은 끝난 방에서 여전히
// 계약을 진행할 수 있다는 것이다.
import { describe, expect, it } from 'vitest'
import {
  canClose,
  isClosed,
  blockedWhenClosed,
  normalizeCloseReason,
  CLOSABLE_STATUSES,
} from '../functions/_lib/roomLifecycle.js'
import { roomStatusInfo } from '../src/lib/roomStatus.js'

describe('canClose', () => {
  it('진행 중인 상태는 닫을 수 있다', () => {
    for (const status of CLOSABLE_STATUSES) {
      expect(canClose({ status }).ok, `${status} 를 닫을 수 있어야 합니다`).toBe(true)
    }
  })

  // 체결된 계약은 종료가 아니라 완료다. 보존 의무가 있는 살아 있는 문서다.
  it('체결된 방은 닫지 않고, 대신 무엇을 해야 하는지 알린다', () => {
    const r = canClose({ status: 'signed' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('근로관계 종료일')
  })

  it('이미 닫힌 방은 다시 닫지 않는다', () => {
    expect(canClose({ status: 'closed' }).ok).toBe(false)
  })

  it('방이 없으면 닫을 수 없다', () => {
    expect(canClose(null).ok).toBe(false)
  })
})

describe('blockedWhenClosed', () => {
  const closed = { status: 'closed' }
  const active = { status: 'active' }

  it('닫힌 방에서는 계약을 앞으로 진행할 수 없다', () => {
    for (const action of ['sign', 'edit_terms', 'confirm_hire', 'change_request', 'draft']) {
      expect(blockedWhenClosed(closed, action), `${action} 이 막혀야 합니다`).toBeTruthy()
    }
  })

  it('열린 방은 아무것도 막지 않는다', () => {
    expect(blockedWhenClosed(active, 'sign')).toBeNull()
  })

  // 전형이 끝났다고 지금까지의 기록을 못 보게 하면, 무슨 일이 있었는지
  // 확인할 길이 사라진다.
  it('모르는 행동에도 안내 문구는 돌려준다', () => {
    expect(blockedWhenClosed(closed, 'unknown_action')).toContain('종료된 전형')
  })

  it('isClosed 가 상태를 그대로 읽는다', () => {
    expect(isClosed(closed)).toBe(true)
    expect(isClosed(active)).toBe(false)
    expect(isClosed(null)).toBe(false)
  })
})

describe('normalizeCloseReason', () => {
  it('아는 사유는 문구로 바꾼다', () => {
    expect(normalizeCloseReason('other_candidate').text).toBe('다른 지원자를 채용했습니다')
  })

  it('모르는 사유는 기타로 받는다', () => {
    expect(normalizeCloseReason('nonsense').code).toBe('other')
  })

  it('덧붙인 설명을 함께 남긴다', () => {
    const r = normalizeCloseReason('terms_not_agreed', '임금 조건 협의 결렬')
    expect(r.text).toContain('합의하지 못했습니다')
    expect(r.text).toContain('임금 조건 협의 결렬')
  })

  it('긴 설명은 잘라 담는다', () => {
    expect(normalizeCloseReason('other', 'ㄱ'.repeat(500)).note.length).toBe(200)
  })
})

describe('화면 라벨', () => {
  // 라벨이 없으면 목록에 'closed' 가 영문 그대로 나온다.
  it('종료된 전형에 한국어 라벨이 있다', () => {
    expect(roomStatusInfo('closed').label).toBe('전형 종료')
  })
})
