import { describe, it, expect } from 'vitest'
import { retentionUntil, renderContractDocument } from '../functions/_lib/contractArchive.js'

// 보존 기간과 정본 문서.
//
// 계약서는 근로관계가 끝난 날부터 3년간 보존해야 한다(근로기준법 제42조,
// 같은 법 시행령 제22조 제2항). 기산일을 잘못 잡으면 아직 보존해야 하는
// 계약서가 만료된 것으로 보이거나, 그 반대가 된다.

describe('보존 만료일', () => {
  it('근로관계가 끝난 날부터 3년', () => {
    expect(retentionUntil('2026-03-15')).toBe('2029-03-15')
  })

  it('재직 중이면 만료일이 없다', () => {
    // 계약 시작일이나 서명일부터 세지 않는다. 기산일은 '끝난 날' 이다.
    expect(retentionUntil(null)).toBeNull()
    expect(retentionUntil('')).toBeNull()
  })

  it('시각이 붙어 있어도 날짜만 본다', () => {
    expect(retentionUntil('2026-03-15 09:30:00')).toBe('2029-03-15')
  })

  it('윤년 2월 29일도 3년 뒤 날짜를 준다', () => {
    // 2029-02-29 는 없는 날이다. 없는 날을 그대로 적으면 안 된다.
    const got = retentionUntil('2024-02-29')
    expect(got).toBe('2027-03-01')
  })

  it('읽을 수 없는 값은 만료일 없음으로 둔다', () => {
    // 여기서 던지면 근로관계 종료 기록 자체가 실패한다.
    expect(retentionUntil('언젠가')).toBeNull()
  })
})

const SNAPSHOT = {
  roomId: 'room-1',
  signedAt: '2026-03-01 02:00:00',
  fingerprint: 'abc123',
  certificateSerial: 'AAAA-BBBB',
  terms: {
    employerName: '(주)한빛테크',
    employeeName: '이지원',
    workLocation: '서울',
    jobDescription: '<script>alert(1)</script>',
    contractStartDate: '2026-03-02',
    wageBaseAmount: 2500000,
  },
  signatures: [
    {
      signerRole: 'company',
      signerName: '박서준',
      signedAt: '2026-03-01 01:00:00',
      imageDataUrl: 'data:image/png;base64,AAA',
      verification: { label: '계정 비밀번호로 인증된 세션' },
    },
    {
      signerRole: 'candidate',
      signerName: '이지원',
      signedAt: '2026-03-01 02:00:00',
      imageDataUrl: null,
      verification: { label: '면접방 입장 코드로 인증된 세션 (계정 비밀번호 확인 없음)' },
    },
  ],
}

describe('보관되는 정본', () => {
  const html = renderContractDocument(SNAPSHOT)

  it('당사자와 계약 내용이 글자 그대로 들어간다', () => {
    // 그림으로 찍으면 3년 뒤에 찾을 수도 복사할 수도 없다.
    expect(html).toContain('(주)한빛테크')
    expect(html).toContain('이지원')
    expect(html).toContain('2,500,000원')
  })

  it('입력된 값이 화면 코드로 실행되지 않게 막는다', () => {
    // 업무 내용은 회사가 자유롭게 적는 칸이다. 그대로 넣으면 이 문서를 여는
    // 사람의 브라우저에서 그 코드가 돈다.
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('무엇으로 본인을 확인했는지 적는다', () => {
    // 코드로 한 서명을 비밀번호 확인이라고 부르면 정본이 거짓이 된다.
    expect(html).toContain('면접방 입장 코드로 인증된 세션 (계정 비밀번호 확인 없음)')
  })

  it('서명 그림이 없으면 없다고 적는다', () => {
    expect(html).toContain('(서명 이미지 없음)')
  })

  it('보존 근거와 지문을 함께 남긴다', () => {
    expect(html).toContain('제42조')
    expect(html).toContain('abc123')
    expect(html).toContain('AAAA-BBBB')
  })

  it('바깥에서 불러오는 것이 없다', () => {
    // 3년 뒤 이 서비스가 없어도, 인터넷이 없어도 열려야 한다.
    expect(html).not.toMatch(/src="https?:/)
    expect(html).not.toMatch(/<link[^>]+href="https?:/)
  })
})
