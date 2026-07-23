import { describe, expect, it } from 'vitest'
import { canManageRecruiting, canManagePosting } from '../functions/_lib/recruiter.js'

describe('canManageRecruiting', () => {
  it('allows admins and recruiters', () => {
    expect(canManageRecruiting({ is_admin: 1, is_recruiter: 0 })).toBe(true)
    expect(canManageRecruiting({ is_admin: 0, is_recruiter: 1 })).toBe(true)
  })
  it('rejects plain accounts and missing users', () => {
    expect(canManageRecruiting({ is_admin: 0, is_recruiter: 0 })).toBe(false)
    expect(canManageRecruiting(null)).toBe(false)
    expect(canManageRecruiting(undefined)).toBe(false)
  })
})

describe('canManagePosting', () => {
  const posting = { id: 'p1', created_by_user_id: 'u-owner' }

  it('lets admins manage any posting', () => {
    expect(canManagePosting({ id: 'u-admin', is_admin: 1 }, posting)).toBe(true)
  })
  it('lets a recruiter manage only their own postings', () => {
    expect(canManagePosting({ id: 'u-owner', is_recruiter: 1 }, posting)).toBe(true)
    expect(canManagePosting({ id: 'u-other', is_recruiter: 1 }, posting)).toBe(false)
  })
  it('rejects plain accounts and missing args', () => {
    expect(canManagePosting({ id: 'u-owner', is_admin: 0, is_recruiter: 0 }, posting)).toBe(false)
    expect(canManagePosting(null, posting)).toBe(false)
    expect(canManagePosting({ id: 'u-owner', is_admin: 1 }, null)).toBe(false)
  })
})
