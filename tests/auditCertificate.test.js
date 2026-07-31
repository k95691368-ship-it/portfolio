import { describe, it, expect } from 'vitest'
import {
  formatSerial,
  parseSerial,
  describeVerificationMethod,
  maskName,
  resolveDocumentIdentity,
  buildCertificate,
  canonicalizeCertificate,
  certificateFingerprint,
  verifyCertificate,
} from '../functions/_lib/auditCertificate.js'

describe('발급번호', () => {
  it('AC-XXXX-XXXX-XXXX 형식으로 만든다', () => {
    const serial = formatSerial(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))
    expect(serial).toMatch(/^AC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  })

  it('혼동되는 글자를 쓰지 않는다', () => {
    const serial = formatSerial(new Uint8Array(Array.from({ length: 12 }, (_, i) => i * 7)))
    expect(serial.replace(/^AC-/, '')).not.toMatch(/[0O1IL]/)
  })

  it('바이트가 모자라면 채운다', () => {
    expect(formatSerial(new Uint8Array([1, 2]))).toMatch(/^AC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  })

  it('사람이 옮겨 적은 번호를 받아들인다', () => {
    const serial = 'AC-ABCD-EFGH-JKMN'
    expect(parseSerial('ac abcd efgh jkmn')).toBe(serial)
    expect(parseSerial('ACABCDEFGHJKMN')).toBe(serial)
    expect(parseSerial('  AC-ABCD-EFGH-JKMN  ')).toBe(serial)
  })

  it('길이가 맞지 않으면 거부한다', () => {
    expect(parseSerial('AC-ABCD')).toBeNull()
    expect(parseSerial('')).toBeNull()
    expect(parseSerial(null)).toBeNull()
  })
})

describe('본인확인 수단 표기', () => {
  it('기록이 없으면 없다고 말한다', () => {
    const v = describeVerificationMethod({})
    expect(v.recorded).toBe(false)
    expect(v.label).toContain('기록 없음')
  })

  it('계정 비밀번호 세션을 구분한다', () => {
    const v = describeVerificationMethod({
      verification_method: 'account_password',
      verified_email: 'hong@example.com',
      session_started_at: '2026-07-30 09:12:00',
    })
    expect(v.recorded).toBe(true)
    expect(v.label).toContain('계정 비밀번호')
    expect(v.detail).toContain('ho')
    // 이메일 원문을 그대로 노출하지 않는다
    expect(v.detail).not.toContain('hong@example.com')
  })

  it('임시 비밀번호 세션을 따로 표기한다', () => {
    expect(describeVerificationMethod({ verification_method: 'temp_password' }).label).toContain(
      '임시 비밀번호'
    )
  })
})

describe('maskName', () => {
  it('첫 글자만 남긴다', () => {
    expect(maskName('홍길동')).toBe('홍**')
    expect(maskName('김')).toBe('김')
    expect(maskName('')).toBe('')
  })
})

describe('resolveDocumentIdentity', () => {
  const sigs = [
    { signer_role: 'company', signed_at: '2026-09-01 10:00:00', document_sha256: 'aaa' },
    { signer_role: 'candidate', signed_at: '2026-09-01 11:00:00', document_sha256: 'aaa' },
  ]

  it('양측이 같은 문서에 서명하고 내용이 그대로면 그렇게 말한다', () => {
    const r = resolveDocumentIdentity({ signatures: sigs, currentSha256: 'aaa' })
    expect(r.allSignersMatch).toBe(true)
    expect(r.signedSha256).toBe('aaa')
    expect(r.unchangedSinceSigning).toBe(true)
    expect(r.statement).toContain('같습니다')
    expect(r.concerns).toEqual([])
  })

  it('서명 이후 내용이 달라지면 짚어낸다', () => {
    const r = resolveDocumentIdentity({ signatures: sigs, currentSha256: 'bbb' })
    expect(r.unchangedSinceSigning).toBe(false)
    expect(r.statement).toContain('다릅니다')
    expect(r.concerns.some((c) => c.includes('달라졌습니다'))).toBe(true)
  })

  it('서명자마다 다른 문서면 짚어낸다', () => {
    const r = resolveDocumentIdentity({
      signatures: [sigs[0], { ...sigs[1], document_sha256: 'zzz' }],
      currentSha256: 'aaa',
    })
    expect(r.allSignersMatch).toBe(false)
    expect(r.signedSha256).toBeNull()
    expect(r.concerns.some((c) => c.includes('서로 다른 문서'))).toBe(true)
  })

  it('지문이 없는 옛 서명을 숨기지 않는다', () => {
    const r = resolveDocumentIdentity({
      signatures: [sigs[0], { signer_role: 'candidate', document_sha256: null }],
      currentSha256: 'aaa',
    })
    expect(r.concerns.some((c) => c.includes('기록되어 있지 않습니다'))).toBe(true)
  })

  it('PDF 바이트 해시는 정본 지문과 구분해 담는다', () => {
    const r = resolveDocumentIdentity({ signatures: sigs, currentSha256: 'aaa', storedPdfSha256: 'pdf1' })
    expect(r.storedPdfSha256).toBe('pdf1')
    expect(r.storedPdfAvailable).toBe(true)
    expect(r.signedSha256).toBe('aaa')
  })

  it('서명이 없어도 무너지지 않는다', () => {
    const r = resolveDocumentIdentity({})
    expect(r.signedSha256).toBeNull()
    expect(r.statement).toContain('확인할 수 없습니다')
  })
})

describe('canonicalizeCertificate', () => {
  const cert = buildCertificate({
    serial: 'AC-ABCD-EFGH-JKMN',
    issuedAt: '2026-09-02 10:00:00',
    issuedByName: '김담당',
    room: { id: 'r1', title: '면접방', status: 'signed' },
    participants: [{ role_in_room: 'candidate', display_name: '홍길동' }],
    signatures: [{ signer_role: 'candidate', signed_at: '2026-09-01', document_sha256: 'aaa' }],
    events: [{ at: '2026-09-01', event: '지원자 서명', detail: 'IP 1.1.1.1' }],
    document: { signedSha256: 'aaa' },
  })

  it('같은 내용이면 같은 문자열', () => {
    expect(canonicalizeCertificate(cert)).toBe(canonicalizeCertificate({ ...cert }))
  })

  it('키 순서가 달라도 같은 문자열', () => {
    const reordered = {}
    for (const k of Object.keys(cert).reverse()) reordered[k] = cert[k]
    expect(canonicalizeCertificate(reordered)).toBe(canonicalizeCertificate(cert))
  })

  it('값이 하나라도 다르면 달라진다', () => {
    expect(canonicalizeCertificate({ ...cert, serial: 'AC-ZZZZ-ZZZZ-ZZZZ' })).not.toBe(
      canonicalizeCertificate(cert)
    )
  })

  // 나중에 항목이 늘어도 기존 부분의 출력이 그대로여야, 옛 증명서가 변조로
  // 뒤집히지 않는다.
  it('새 항목이 붙어도 기존 줄은 그대로다', () => {
    const before = canonicalizeCertificate(cert).split('\n')
    const after = canonicalizeCertificate({ ...cert, newSection: { a: 1 } }).split('\n')
    for (const line of before) expect(after).toContain(line)
  })

  it('버전을 첫 줄에 둔다', () => {
    expect(canonicalizeCertificate(cert).split('\n')[0]).toBe('version=AC-1')
  })

  it('이름을 가려서 담는다', () => {
    expect(canonicalizeCertificate(cert)).toContain('홍**')
    expect(canonicalizeCertificate(cert)).not.toContain('홍길동')
  })
})

describe('certificateFingerprint', () => {
  it('SHA-256 16진 64자', async () => {
    expect(await certificateFingerprint('hello')).toMatch(/^[0-9a-f]{64}$/)
  })
  it('같은 문자열은 같은 지문', async () => {
    expect(await certificateFingerprint('a')).toBe(await certificateFingerprint('a'))
  })
  it('한 글자만 달라도 지문이 바뀐다', async () => {
    expect(await certificateFingerprint('a')).not.toBe(await certificateFingerprint('b'))
  })
})

describe('verifyCertificate', () => {
  it('지문이 맞으면 유효', () => {
    const r = verifyCertificate({ storedSha256: 'x', recomputedSha256: 'x' })
    expect(r.valid).toBe(true)
    expect(r.label).toContain('유효')
  })

  it('보관된 기록이 변조되면 잡아낸다', () => {
    const r = verifyCertificate({ storedSha256: 'x', recomputedSha256: 'y' })
    expect(r.valid).toBe(false)
    expect(r.tampered).toBe(true)
  })

  it('취소된 증명서를 구분한다', () => {
    const r = verifyCertificate({ storedSha256: 'x', recomputedSha256: 'x', revokedAt: '2026-09-05' })
    expect(r.valid).toBe(false)
    expect(r.label).toContain('취소')
  })

  it('제시한 지문이 다르면 알린다', () => {
    const r = verifyCertificate({ storedSha256: 'x', recomputedSha256: 'x', providedSha256: 'z' })
    expect(r.valid).toBe(false)
    expect(r.matchesProvided).toBe(false)
  })

  it('제시한 지문이 같으면 유효', () => {
    const r = verifyCertificate({ storedSha256: 'x', recomputedSha256: 'x', providedSha256: 'x' })
    expect(r.valid).toBe(true)
    expect(r.matchesProvided).toBe(true)
  })
})
