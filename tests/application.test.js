import { describe, expect, it } from 'vitest'
import {
  parseBool,
  isValidEmail,
  validateApplication,
  normalizeCareer,
} from '../functions/_lib/application.js'

describe('parseBool', () => {
  it('treats common truthy string forms as true', () => {
    expect(parseBool('true')).toBe(true)
    expect(parseBool('1')).toBe(true)
    expect(parseBool('on')).toBe(true)
    expect(parseBool(true)).toBe(true)
  })
  it('treats everything else as false', () => {
    expect(parseBool('false')).toBe(false)
    expect(parseBool('0')).toBe(false)
    expect(parseBool('')).toBe(false)
    expect(parseBool(null)).toBe(false)
    expect(parseBool(undefined)).toBe(false)
  })
})

describe('isValidEmail', () => {
  it('accepts valid addresses', () => {
    expect(isValidEmail('a@b.com')).toBe(true)
    expect(isValidEmail('user.name@example.co.kr')).toBe(true)
  })
  it('rejects invalid addresses', () => {
    expect(isValidEmail('nope')).toBe(false)
    expect(isValidEmail('a@b')).toBe(false)
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail(null)).toBe(false)
  })
})

describe('validateApplication', () => {
  const base = { name: '홍길동', email: 'hong@example.com', phone: '010-1234-5678', consentRequired: true }

  it('passes with all required fields and consent', () => {
    expect(validateApplication(base)).toBeNull()
  })
  it('requires a name', () => {
    expect(validateApplication({ ...base, name: '  ' })).toMatch(/이름/)
  })
  it('requires a valid email', () => {
    expect(validateApplication({ ...base, email: 'bad' })).toMatch(/이메일/)
  })
  it('requires a phone', () => {
    expect(validateApplication({ ...base, phone: '' })).toMatch(/연락처/)
  })
  it('requires the mandatory consent', () => {
    expect(validateApplication({ ...base, consentRequired: false })).toMatch(/필수항목/)
  })
})

describe('normalizeCareer', () => {
  it('returns null for empty input', () => {
    expect(normalizeCareer('')).toEqual({ ok: true, value: null })
    expect(normalizeCareer(null)).toEqual({ ok: true, value: null })
    expect(normalizeCareer('[]')).toEqual({ ok: true, value: null })
  })
  it('rejects malformed JSON', () => {
    const result = normalizeCareer('{not json')
    expect(result.ok).toBe(false)
  })
  it('rejects non-array JSON', () => {
    const result = normalizeCareer('{"a":1}')
    expect(result.ok).toBe(false)
  })
  it('rejects too many entries', () => {
    const many = JSON.stringify(Array.from({ length: 21 }, () => ({ companyName: 'x' })))
    expect(normalizeCareer(many).ok).toBe(false)
  })
  it('keeps known fields and coerces current to boolean', () => {
    const raw = JSON.stringify([
      { companyName: '테스트회사', position: '주임', current: 'yes', junk: 'drop-me' },
    ])
    const result = normalizeCareer(raw)
    expect(result.ok).toBe(true)
    const parsed = JSON.parse(result.value)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].companyName).toBe('테스트회사')
    expect(parsed[0].position).toBe('주임')
    expect(parsed[0].current).toBe(true)
    expect(parsed[0].junk).toBeUndefined()
  })
  it('accepts an array value directly (not only a JSON string)', () => {
    const result = normalizeCareer([{ companyName: 'ACME' }])
    expect(result.ok).toBe(true)
    expect(JSON.parse(result.value)[0].companyName).toBe('ACME')
  })
})
