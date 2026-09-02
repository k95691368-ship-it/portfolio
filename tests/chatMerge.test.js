// 대화가 한 줄도 사라지지 않는지 확인한다.
//
// 면접 대화는 계약 조건이 어디서 합의됐는지를 보여 주는 기록이고, 서명 전 점검이
// 그것을 근거로 "합의와 계약서가 다르다"를 판정한다. 한 줄이 사라지면 판정도
// 사라진다.
import { describe, expect, it } from 'vitest'
import {
  mergeById,
  roomMessageBody,
  roomMessagesPath,
} from '../src/hooks/useChatPolling.js'

describe('mergeById', () => {
  it('새 메시지를 뒤에 붙인다', () => {
    const merged = mergeById([{ id: 1 }, { id: 2 }], [{ id: 3 }])
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('이미 가진 메시지는 두 번 넣지 않는다', () => {
    // 내가 보낸 메시지는 응답 즉시 화면에 붙고, 폴링이 같은 것을 다시 가져온다.
    const merged = mergeById([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }])
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3])
  })

  it('새로울 것이 없으면 같은 배열을 그대로 돌려준다', () => {
    const prev = [{ id: 1 }, { id: 2 }]
    expect(mergeById(prev, [{ id: 2 }])).toBe(prev)
  })

  // 낙관적으로 붙인 내 메시지(id 11)보다 먼저 보내진 상대 메시지(id 10)가
  // 나중에 도착할 수 있다. 도착 순서가 아니라 id 순서가 대화 순서다.
  it('늦게 도착한 앞선 메시지를 제자리에 끼워 넣는다', () => {
    const merged = mergeById([{ id: 9 }, { id: 11, mine: true }], [{ id: 10 }, { id: 12 }])
    expect(merged.map((m) => m.id)).toEqual([9, 10, 11, 12])
  })

  it('여러 개가 한꺼번에 와도 순서를 지킨다', () => {
    const merged = mergeById([{ id: 5 }], [{ id: 8 }, { id: 6 }, { id: 7 }])
    expect(merged.map((m) => m.id)).toEqual([5, 6, 7, 8])
  })

  it('빈 상태에서도 동작한다', () => {
    expect(mergeById([], [{ id: 1 }]).map((m) => m.id)).toEqual([1])
    expect(mergeById([], [])).toEqual([])
  })
})

describe('roomMessagesPath', () => {
  it('keeps existing room chat paths unchanged', () => {
    expect(roomMessagesPath('room-1', { after: 7 })).toBe('/rooms/room-1/messages?after=7')
  })

  it('scopes interview chat requests to one registered session', () => {
    expect(
      roomMessagesPath('room-1', {
        after: 0,
        interviewSessionId: 'session/1',
      })
    ).toBe('/rooms/room-1/messages?after=0&interviewSessionId=session%2F1')
    expect(
      roomMessagesPath('room-1', { interviewSessionId: 'session/1' })
    ).toBe('/rooms/room-1/messages?interviewSessionId=session%2F1')
    expect(roomMessageBody('면접 메시지', 'session/1')).toEqual({
      body: '면접 메시지',
      interviewSessionId: 'session/1',
    })
    expect(roomMessageBody('기존 방 메시지')).toEqual({ body: '기존 방 메시지' })
  })
})
