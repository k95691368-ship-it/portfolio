import { describe, it, expect } from 'vitest'
import {
  genInviteCode,
  normalizeInviteCode,
  formatInviteCode,
} from '../functions/_lib/inviteCode.js'
import { roomIdFromApiPath } from '../functions/_lib/auth.js'
import { signerVerificationMethod, describeVerificationMethod } from '../functions/_lib/auditCertificate.js'

describe('면접방 입장 코드', () => {
  it('12자리다 — 코드가 로그인 수단이므로 6자리로는 맞힐 수 있다', () => {
    for (let i = 0; i < 20; i += 1) expect(genInviteCode()).toHaveLength(12)
  })

  it('헷갈리는 글자를 쓰지 않는다 (0/O, 1/I/L)', () => {
    // 메일에서 눈으로 읽어 손으로 옮겨 적는 값이다.
    for (let i = 0; i < 50; i += 1) {
      expect(genInviteCode()).not.toMatch(/[0O1IL]/)
    }
  })

  it('사람이 옮겨 적은 모양을 그대로 받아들인다', () => {
    // 화면이 하이픈으로 끊어 보여 주므로 하이픈째 붙여 넣는 사람이 있다.
    expect(normalizeInviteCode('ac3k-m7pq-4rtv')).toBe('AC3KM7PQ4RTV')
    expect(normalizeInviteCode(' AC3K M7PQ 4RTV ')).toBe('AC3KM7PQ4RTV')
    expect(normalizeInviteCode(null)).toBe('')
  })

  it('네 자씩 끊어 보여 준다', () => {
    expect(formatInviteCode('AC3KM7PQ4RTV')).toBe('AC3K-M7PQ-4RTV')
    // 예전에 발급된 6자리는 끊지 않는다 — 끊으면 다른 값처럼 보인다.
    expect(formatInviteCode('A3KM7P')).toBe('A3KM7P')
  })

  it('보여 준 모양을 다시 넣어도 같은 코드다', () => {
    const code = genInviteCode()
    expect(normalizeInviteCode(formatInviteCode(code))).toBe(code)
  })
})

describe('방 안의 요청인가', () => {
  it('방 안 요청에서만 방 id 를 읽는다', () => {
    expect(roomIdFromApiPath('/api/rooms/abc-123/view')).toBe('abc-123')
    expect(roomIdFromApiPath('/api/rooms/abc-123/contract-view')).toBe('abc-123')
  })

  it('입장 요청은 방 안이 아니다 — 아직 어느 방인지 정해지기 전이다', () => {
    expect(roomIdFromApiPath('/api/rooms/enter')).toBe(null)
    expect(roomIdFromApiPath('/api/rooms/create')).toBe(null)
  })

  it('방 밖 경로에는 걸리지 않는다', () => {
    // 코드 세션이 대시보드나 관리자 화면으로 번지면 코드가 계정 비밀번호가 된다.
    expect(roomIdFromApiPath('/api/dashboard')).toBe(null)
    expect(roomIdFromApiPath('/api/me')).toBe(null)
    expect(roomIdFromApiPath('/api/admin/users/1')).toBe(null)
  })
})

describe('서명의 본인확인 수단', () => {
  it('코드로 들어온 세션은 비밀번호 확인이라고 적지 않는다', () => {
    // 코드는 회사 담당자도 볼 수 있는 값이다. 그것을 비밀번호 확인이라고
    // 부르면 이 앱이 만들려는 증명서 자체가 거짓이 된다.
    expect(signerVerificationMethod({ session_auth_method: 'invite_code' })).toBe('invite_code')
  })

  it('임시 비밀번호를 아직 안 바꾼 계정이어도 코드가 우선이다', () => {
    expect(
      signerVerificationMethod({ session_auth_method: 'invite_code', must_change_password: 1 })
    ).toBe('invite_code')
  })

  it('비밀번호 로그인은 예전 그대로', () => {
    expect(signerVerificationMethod({ session_auth_method: 'password' })).toBe('account_password')
    expect(signerVerificationMethod({ must_change_password: 1 })).toBe('temp_password')
    expect(signerVerificationMethod({})).toBe('account_password')
  })

  it('증명서 문구가 코드 인증을 그대로 밝힌다', () => {
    const described = describeVerificationMethod({ verification_method: 'invite_code' })
    expect(described.recorded).toBe(true)
    expect(described.label).toContain('입장 코드')
    expect(described.label).toContain('계정 비밀번호 확인 없음')
  })
})
