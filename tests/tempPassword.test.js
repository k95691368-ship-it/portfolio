import { describe, it, expect } from 'vitest'
import { genTempPassword } from '../functions/_lib/tempPassword.js'

const ALLOWED = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]+$/

describe('genTempPassword', () => {
  it('is 16 characters long', () => {
    expect(genTempPassword()).toHaveLength(16)
  })

  it('only uses the unambiguous alphabet (no 0/O/1/I/l)', () => {
    for (let i = 0; i < 200; i++) {
      const pw = genTempPassword()
      expect(pw).toMatch(ALLOWED)
      expect(pw).not.toMatch(/[0O1Il]/)
    }
  })

  it('is effectively unique across calls', () => {
    const seen = new Set()
    for (let i = 0; i < 500; i++) seen.add(genTempPassword())
    expect(seen.size).toBe(500)
  })
})
