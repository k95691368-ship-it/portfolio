// 감사 로그의 세부정보는 나중에 "무엇을 지웠는가"를 따질 때 읽히는 자리다.
// 코드 안에서 쓰는 이름이 그대로 나오면 그 자리에서 아무것도 읽어 내지 못한다.
import { describe, expect, it } from 'vitest'
import { describeAuditDetail } from '../src/lib/auditDetail.js'

describe('감사 로그 세부정보', () => {
  it('면접방 이름을 사람이 읽는 말로 옮긴다', () => {
    expect(describeAuditDetail('title=테스트 1')).toBe('면접방 이름: 테스트 1')
  })

  it('여러 항목은 나란히 읽힌다', () => {
    expect(describeAuditDetail('email=a@b.com, role=company, isRecruiter=true')).toBe(
      '이메일: a@b.com · 역할: 회사 · 채용자 권한: 있음'
    )
  })

  it('값에 등호가 들어 있어도 첫 등호에서만 나눈다', () => {
    expect(describeAuditDetail('title=a=b')).toBe('면접방 이름: a=b')
  })

  it('이미 한국어로 적힌 것은 그대로 둔다', () => {
    expect(describeAuditDetail('발급번호=EPA-2026-0001')).toBe('발급번호: EPA-2026-0001')
    expect(describeAuditDetail('title=테스트 · 보존의무 확인 후 삭제 (보존기한 2029-08-11)')).toBe(
      '면접방 이름: 테스트 · 보존의무 확인 후 삭제 (보존기한 2029-08-11)'
    )
  })

  it('모르는 이름은 지어내지 않고 그대로 보여 준다', () => {
    expect(describeAuditDetail('somethingNew=1')).toBe('somethingNew=1')
  })

  it('비어 있으면 빈 칸으로 둔다', () => {
    expect(describeAuditDetail(null)).toBe('-')
    expect(describeAuditDetail('')).toBe('-')
  })
})
