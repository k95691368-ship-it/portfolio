import { describe, it, expect } from 'vitest'
import { rowToCamelTerms } from '../functions/_lib/contract.js'

describe('rowToCamelTerms', () => {
  it('returns null for a falsy row', () => {
    expect(rowToCamelTerms(null)).toBe(null)
    expect(rowToCamelTerms(undefined)).toBe(null)
  })

  it('maps snake_case columns to camelCase fields', () => {
    const row = {
      employer_name: '검증㈜',
      employee_name: '홍길동',
      work_location: '본사',
      wage_base_amount: 3000000,
    }
    const t = rowToCamelTerms(row)
    expect(t.employerName).toBe('검증㈜')
    expect(t.employeeName).toBe('홍길동')
    expect(t.workLocation).toBe('본사')
    expect(t.wageBaseAmount).toBe(3000000)
  })

  it('parses the JSON columns and defaults customTerms to an empty array', () => {
    const row = {
      social_insurance_json: JSON.stringify({ health_insurance: true }),
      custom_terms_json: null,
      ai_document_json: JSON.stringify([{ heading: '제1조', body: '...' }]),
    }
    const t = rowToCamelTerms(row)
    expect(t.socialInsurance).toEqual({ health_insurance: true })
    expect(t.customTerms).toEqual([])
    expect(t.aiDocument).toEqual([{ heading: '제1조', body: '...' }])
  })

  it('leaves socialInsurance/aiDocument null when their columns are empty', () => {
    const t = rowToCamelTerms({})
    expect(t.socialInsurance).toBe(null)
    expect(t.aiDocument).toBe(null)
    expect(t.customTerms).toEqual([])
  })
})
