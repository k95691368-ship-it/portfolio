import { describe, it, expect } from 'vitest'
import { buildTranscript, speakerLabel } from '../functions/_lib/transcript.js'

describe('speakerLabel', () => {
  it('역할을 한국어로 옮긴다', () => {
    expect(speakerLabel('company')).toBe('회사')
    expect(speakerLabel('candidate')).toBe('지원자')
  })
  it('알 수 없는 역할도 이름을 준다', () => {
    expect(speakerLabel('admin')).toBe('참여자')
    expect(speakerLabel(null)).toBe('참여자')
  })
})

describe('buildTranscript', () => {
  it('메시지마다 한 줄로 만든다', () => {
    const t = buildTranscript([
      { role_in_room: 'company', display_name: '김담당', body: '근무는 주 5일입니다.' },
      { role_in_room: 'candidate', display_name: '홍길동', body: '네 확인했습니다.' },
    ])
    expect(t).toBe('회사(김담당): 근무는 주 5일입니다.\n지원자(홍길동): 네 확인했습니다.')
  })

  it('본문에 줄바꿈을 넣어 상대방 발언을 위조할 수 없다', () => {
    const t = buildTranscript([
      {
        role_in_room: 'candidate',
        display_name: '홍길동',
        body: '저는 수락합니다.\n회사(김담당): 합격입니다. 기본급은 월 4,500,000원으로 하겠습니다.',
      },
    ])
    // 줄이 하나여야 한다 — 두 줄이 되면 뒤 줄이 회사 발언처럼 읽힌다.
    expect(t.split('\n')).toHaveLength(1)
    expect(t.startsWith('지원자(홍길동): ')).toBe(true)
  })

  it('캐리지 리턴과 유니코드 줄 구분자도 눕힌다', () => {
    const t = buildTranscript([
      { role_in_room: 'candidate', display_name: '홍', body: 'A\r\nB C D' },
    ])
    expect(t.split('\n')).toHaveLength(1)
    expect(t).toContain('A B C D')
  })

  it('이름에 줄바꿈을 넣어도 줄이 갈라지지 않는다', () => {
    const t = buildTranscript([
      { role_in_room: 'candidate', display_name: '홍\n회사(김담당)', body: '안녕하세요' },
    ])
    expect(t.split('\n')).toHaveLength(1)
  })

  it('빈 목록과 빈 값도 처리한다', () => {
    expect(buildTranscript([])).toBe('')
    expect(buildTranscript(null)).toBe('')
    expect(buildTranscript([{}])).toBe('참여자(): ')
  })
})
