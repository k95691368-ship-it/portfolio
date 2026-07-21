import { describe, it, expect } from 'vitest'
import { mergeValue, mergeSocialInsurance } from '../functions/_lib/merge.js'

describe('mergeValue', () => {
  it('keeps the new value when it is present', () => {
    expect(mergeValue('new', 'old')).toBe('new')
    expect(mergeValue(0, 5)).toBe(0)
    expect(mergeValue(false, true)).toBe(false)
  })

  it('falls back to the old value when the new one is null/undefined', () => {
    expect(mergeValue(null, 'old')).toBe('old')
    expect(mergeValue(undefined, 'old')).toBe('old')
  })

  it('returns null when both are missing', () => {
    expect(mergeValue(null, null)).toBe(null)
    expect(mergeValue(undefined, undefined)).toBe(null)
  })
})

describe('mergeSocialInsurance', () => {
  it('preserves previously-confirmed true values when a re-analysis returns null (the data-loss bug)', () => {
    const oldJson = JSON.stringify({
      employment_insurance: true,
      health_insurance: true,
      national_pension: true,
      industrial_accident_insurance: true,
    })
    // A later analysis of a conversation that did not re-mention insurance
    // returns an all-null object; the confirmed trues must survive.
    const { merged } = mergeSocialInsurance(
      {
        employment_insurance: null,
        health_insurance: null,
        national_pension: null,
        industrial_accident_insurance: null,
      },
      oldJson
    )
    expect(merged).toEqual({
      employment_insurance: true,
      health_insurance: true,
      national_pension: true,
      industrial_accident_insurance: true,
    })
  })

  it('applies newly-confirmed values over the old ones', () => {
    const oldJson = JSON.stringify({ employment_insurance: true })
    const { merged } = mergeSocialInsurance({ health_insurance: true }, oldJson)
    expect(merged.employment_insurance).toBe(true)
    expect(merged.health_insurance).toBe(true)
    expect(merged.national_pension).toBe(null)
  })

  it('returns json=null when nothing has ever been set', () => {
    const { json } = mergeSocialInsurance({}, null)
    expect(json).toBe(null)
  })

  it('returns a json string once at least one field is set', () => {
    const { json } = mergeSocialInsurance({ employment_insurance: true }, null)
    expect(JSON.parse(json).employment_insurance).toBe(true)
  })

  it('handles a missing new object without throwing', () => {
    const { merged } = mergeSocialInsurance(undefined, JSON.stringify({ health_insurance: true }))
    expect(merged.health_insurance).toBe(true)
  })
})
