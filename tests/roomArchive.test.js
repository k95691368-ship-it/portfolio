// 보관은 지금 상태 그대로 잠그는 일이다.
//
// 종료(closed)는 "이 사람으로 진행하지 않는다"는 결정이고 체결(signed)은
// "계약이 성립했다"는 사실이다. 보관은 그 둘 중 어느 쪽이든 더 손대지
// 못하게 하는 것이라, status 를 덮지 않고 따로 표시한다.
import { describe, expect, it } from 'vitest'
import {
  isArchived,
  canArchive,
  canUnarchive,
  blockedWhenArchived,
  blockedWhenFrozen,
  blockedWhenClosed,
} from '../functions/_lib/roomLifecycle.js'

const room = (over = {}) => ({ status: 'active', archived_at: null, ...over })

describe('보관 여부', () => {
  it('archived_at 이 차면 보관된 것이다', () => {
    expect(isArchived(room())).toBe(false)
    expect(isArchived(room({ archived_at: '2026-08-12 09:00:00' }))).toBe(true)
  })

  // 호출부는 대부분 'SELECT status FROM interview_rooms' 로 방을 읽는다.
  // 거기에 archived_at 을 넣는 것을 잊으면 잠금이 조용히 꺼진다 — 검사는
  // 도는데 검사하려던 것이 빠져 있는, 이 저장소에서 반복된 모양이다.
  it('그 칸을 읽지 않고 물으면 조용히 넘기지 않는다', () => {
    expect(() => isArchived({ status: 'active' })).toThrow(/archived_at/)
  })

  it('방이 아예 없으면 묻지 않은 것으로 본다', () => {
    expect(isArchived(null)).toBe(false)
    expect(isArchived(undefined)).toBe(false)
  })
})

describe('보관할 수 있는가', () => {
  it('종료된 방도 체결된 방도 보관할 수 있다', () => {
    expect(canArchive(room({ status: 'closed' })).ok).toBe(true)
    expect(canArchive(room({ status: 'signed' })).ok).toBe(true)
    expect(canArchive(room()).ok).toBe(true)
  })

  it('이미 보관된 방은 두 번 보관하지 않는다', () => {
    expect(canArchive(room({ archived_at: '2026-08-12 09:00:00' })).ok).toBe(false)
  })

  it('없는 방은 보관할 수 없다', () => {
    expect(canArchive(null).ok).toBe(false)
    expect(canUnarchive(null).ok).toBe(false)
  })

  it('보관되지 않은 방은 해제할 것이 없다', () => {
    expect(canUnarchive(room()).ok).toBe(false)
    expect(canUnarchive(room({ archived_at: '2026-08-12 09:00:00' })).ok).toBe(true)
  })
})

describe('보관된 방에서 막히는 것', () => {
  const archived = room({ archived_at: '2026-08-12 09:00:00' })

  // 사용자가 요청한 두 가지.
  it('대화를 칠 수 없다', () => {
    expect(blockedWhenArchived(archived, 'message')).toMatch(/대화할 수 없습니다/)
  })

  it('계약서 파일을 저장할 수 없다', () => {
    expect(blockedWhenArchived(archived, 'store_contract')).toMatch(/계약서 파일을 저장할 수 없습니다/)
  })

  it('계약 조건 수정과 서명도 막힌다', () => {
    expect(blockedWhenArchived(archived, 'edit_terms')).toBeTruthy()
    expect(blockedWhenArchived(archived, 'sign')).toBeTruthy()
  })

  it('이름 없는 작업도 막는다 — 모르는 것을 열어 두지 않는다', () => {
    expect(blockedWhenArchived(archived, '아직없는작업')).toBeTruthy()
  })

  // 방에 무언가를 더하는 일은 전부 막힌다. 특히 최종합격 통보는 채용내정을
  // 성립시키는 바로 그 행위인데, 정작 그 방에서는 답할 수 없다.
  it('최종합격·초대 이메일과 면접 요약도 막힌다', () => {
    expect(blockedWhenArchived(archived, 'final_offer_email')).toMatch(/최종합격/)
    expect(blockedWhenArchived(archived, 'invite_email')).toMatch(/초대/)
    expect(blockedWhenArchived(archived, 'interview_summary')).toMatch(/면접 요약/)
  })

  it('보관되지 않았으면 아무것도 막지 않는다', () => {
    expect(blockedWhenArchived(room(), 'message')).toBeNull()
    expect(blockedWhenArchived(room(), 'sign')).toBeNull()
  })
})

describe('종료와 보관의 차이', () => {
  // 종료된 방에서는 "끝났습니다"를 주고받을 자리가 있어야 한다.
  it('종료된 방에서는 대화를 막지 않는다', () => {
    expect(blockedWhenClosed(room({ status: 'closed' }), 'message')).toBeNull()
    expect(blockedWhenFrozen(room({ status: 'closed' }), 'message')).toBeNull()
  })

  it('종료되거나 보관된 방에서는 화상 면접 생성·입장·녹화를 막는다', () => {
    for (const action of ['create_interview', 'edit_interview', 'join_interview', 'start_recording']) {
      expect(blockedWhenFrozen(room({ status: 'closed' }), action)).toBeTruthy()
      expect(blockedWhenFrozen(room({ archived_at: '2026-08-12 09:00:00' }), action)).toBeTruthy()
    }
  })

  it('보관된 방에서는 막는다', () => {
    expect(blockedWhenFrozen(room({ archived_at: '2026-08-12 09:00:00' }), 'message')).toBeTruthy()
  })

  it('둘 다면 보관 쪽 안내를 보여 준다 — 더 강한 잠금이 먼저다', () => {
    const both = room({ status: 'closed', archived_at: '2026-08-12 09:00:00' })
    expect(blockedWhenFrozen(both, 'sign')).toMatch(/보관된/)
  })

  it('아무것도 아니면 통과시킨다', () => {
    expect(blockedWhenFrozen(room(), 'sign')).toBeNull()
  })
})
