import { describe, expect, it } from 'vitest'
import { validateUploadFile, fileExt, matchesSignature } from '../functions/_lib/uploads.js'

function fakeFile(name, size) {
  return { name, size }
}

describe('validateUploadFile', () => {
  it('accepts a normal PDF', () => {
    expect(validateUploadFile(fakeFile('resume.pdf', 1024))).toBeNull()
  })
  it('rejects a missing file', () => {
    expect(validateUploadFile(null)).toMatch(/파일/)
    expect(validateUploadFile('not-a-file')).toMatch(/파일/)
  })
  it('rejects a 0-byte file', () => {
    expect(validateUploadFile(fakeFile('resume.pdf', 0))).toMatch(/빈 파일/)
  })
  it('rejects a file over 10MB', () => {
    expect(validateUploadFile(fakeFile('resume.pdf', 11 * 1024 * 1024))).toMatch(/10MB/)
  })
  it('rejects a disallowed extension', () => {
    expect(validateUploadFile(fakeFile('malware.exe', 1024))).toMatch(/PDF/)
  })
})

describe('matchesSignature (매직바이트)', () => {
  it('accepts a real PDF header', () => {
    expect(matchesSignature([0x25, 0x50, 0x44, 0x46, 0x2d], 'pdf')).toBe(true)
  })
  it('accepts ZIP-based docx/hwpx', () => {
    expect(matchesSignature([0x50, 0x4b, 0x03, 0x04], 'docx')).toBe(true)
    expect(matchesSignature([0x50, 0x4b, 0x03, 0x04], 'hwpx')).toBe(true)
  })
  it('accepts OLE-based doc/hwp', () => {
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
    expect(matchesSignature(ole, 'doc')).toBe(true)
    expect(matchesSignature(ole, 'hwp')).toBe(true)
  })
  it('rejects a fake/renamed file (content mismatch)', () => {
    expect(matchesSignature([0x00, 0x01, 0x02, 0x03], 'pdf')).toBe(false)
    // PDF 내용을 .docx 로 위장한 경우
    expect(matchesSignature([0x25, 0x50, 0x44, 0x46], 'docx')).toBe(false)
  })
})

describe('fileExt', () => {
  it('extracts the lowercased extension', () => {
    expect(fileExt('a.PDF')).toBe('pdf')
    expect(fileExt('my.file.docx')).toBe('docx')
    expect(fileExt('noext')).toBe('noext')
  })
})
