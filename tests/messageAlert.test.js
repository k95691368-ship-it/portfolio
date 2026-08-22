import { describe, it, expect } from 'vitest'
import { shouldEmailCandidate } from '../functions/_lib/messageAlert.js'

// 지원자에게 메일을 보낼 것인가.
//
// 이 판단이 느슨하면 대화 한 줄마다 메일이 나가 지원자의 메일함이 막히고,
// 그러면 정작 중요한 메일(서류합격·최종합격)이 그 사이에 묻힌다. 반대로
// 너무 빡빡하면 지원자가 아무 소식도 못 받아 협의가 멈춘다.
const NOW = '2026-08-15T12:00:00.000Z'
const ago = (min) => new Date(Date.parse(NOW) - min * 60_000).toISOString()

describe('새 메시지 메일을 보낼 것인가', () => {
  it('처음이면 보낸다', () => {
    expect(shouldEmailCandidate({ lastEmailAt: null, lastSeenAt: null, now: NOW })).toBe(true)
  })

  it('방금 보냈으면 다시 보내지 않는다', () => {
    // 대화는 한 번에 여러 줄이 오간다. 줄마다 보내면 메일함이 막힌다.
    expect(shouldEmailCandidate({ lastEmailAt: ago(1), lastSeenAt: null, now: NOW })).toBe(false)
    expect(shouldEmailCandidate({ lastEmailAt: ago(29), lastSeenAt: null, now: NOW })).toBe(false)
  })

  it('조용한 시간이 지나면 다시 보낸다', () => {
    expect(shouldEmailCandidate({ lastEmailAt: ago(31), lastSeenAt: null, now: NOW })).toBe(true)
  })

  it('지원자가 방금까지 보고 있었으면 보내지 않는다', () => {
    // 눈앞에서 대화하는 사람에게 "새 메시지가 도착했습니다"는 방해다.
    expect(shouldEmailCandidate({ lastEmailAt: null, lastSeenAt: ago(1), now: NOW })).toBe(false)
  })

  it('한동안 안 들어왔으면 보낸다', () => {
    expect(shouldEmailCandidate({ lastEmailAt: null, lastSeenAt: ago(10), now: NOW })).toBe(true)
  })

  it('보고 있었으면 조용한 시간이 지났어도 보내지 않는다', () => {
    expect(shouldEmailCandidate({ lastEmailAt: ago(60), lastSeenAt: ago(1), now: NOW })).toBe(false)
  })

  it('SQLite 가 적는 모양(공백 구분)도 읽는다', () => {
    // datetime('now') 는 "2026-08-15 11:59:00" 으로 적힌다. 이것을 못 읽으면
    // 언제나 '처음'으로 판단해 메일이 매번 나간다.
    expect(shouldEmailCandidate({ lastEmailAt: '2026-08-15 11:59:00', lastSeenAt: null, now: NOW }))
      .toBe(false)
  })

  it('읽을 수 없는 값은 없는 것으로 본다', () => {
    expect(shouldEmailCandidate({ lastEmailAt: '어제', lastSeenAt: null, now: NOW })).toBe(true)
  })
})
