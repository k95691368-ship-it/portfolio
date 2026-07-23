import { describe, expect, it } from 'vitest'
import { validateUploadFile, fileExt } from '../functions/_lib/uploads.js'

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

describe('fileExt', () => {
  it('extracts the lowercased extension', () => {
    expect(fileExt('a.PDF')).toBe('pdf')
    expect(fileExt('my.file.docx')).toBe('docx')
    expect(fileExt('noext')).toBe('noext')
  })
})
