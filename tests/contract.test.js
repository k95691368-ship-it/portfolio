import { describe, it, expect } from 'vitest'
import {
  rowToCamelTerms,
  buildArticlesFromTerms,
  buildArticlesForTranslation,
} from '../functions/_lib/contract.js'

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

// 번역 원본에서 빠져 있던 조항들. 외국인 근로자가 읽는 계약서에만 수습 조항이
// 없으면, 정작 그 조항의 적용을 받는 사람이 그것을 모른다.
describe('buildArticlesForTranslation — 빠짐없이 옮기는가', () => {
  const TERMS = {
    contractStartDate: '2026-09-01',
    workLocation: '서울',
    jobDescription: '백엔드 개발',
    workHoursStart: '09:00',
    workHoursEnd: '18:00',
    workDays: '주 5일',
    restDays: '토·일',
    wageBaseAmount: 1900000,
    wagePayMethod: '계좌이체',
    wagePayDate: '매월 25일',
    annualLeave: '근로기준법에 따름',
    uniformSize: 'L',
    customTerms: [{ label: '수습기간', value: '3개월 (임금의 95% 지급)' }],
  }

  it('그 밖의 사항과 유니폼 사이즈가 조항에 들어간다', () => {
    const bodies = buildArticlesForTranslation(TERMS).map((a) => a.body).join(' | ')
    expect(bodies).toContain('수습기간: 3개월')
    expect(bodies).toContain('L')
  })

  it('임금은 구성항목이 있으면 항목별로 적는다', () => {
    const bodies = buildArticlesForTranslation({
      ...TERMS,
      wageItems: [
        { name: '기본급', type: 'base', amount: 1900000 },
        { name: '고정연장수당', type: 'overtime_fixed', amount: 750000 },
      ],
    })
      .map((a) => a.body)
      .join(' | ')
    expect(bodies).toContain('기본급 1,900,000원')
    expect(bodies).toContain('고정연장수당 750,000원')
  })

  it('구성항목이 없으면 예전과 같이 기본급만 적는다', () => {
    const bodies = buildArticlesForTranslation(TERMS).map((a) => a.body).join(' | ')
    expect(bodies).toContain('기본급 1,900,000원')
  })
})

// 정본 본문 생성기는 지문의 일부다. 여기에 조항을 더하면 이미 서명된 계약서의
// 지문이 소급해서 바뀌어, 아무도 손대지 않은 계약이 변조로 뒤집힌다.
describe('buildArticlesFromTerms — 지문이 흔들리지 않는가', () => {
  const T = {
    contractStartDate: '2026-09-01',
    workLocation: '서울',
    jobDescription: '백엔드 개발',
    workHoursStart: '09:00',
    workHoursEnd: '18:00',
    workDays: '주 5일',
    restDays: '토·일',
    wageBaseAmount: 1900000,
    wagePayMethod: '계좌이체',
    wagePayDate: '매월 25일',
    annualLeave: '근로기준법에 따름',
  }

  it('그 밖의 사항과 유니폼 사이즈는 정본 본문을 바꾸지 않는다', () => {
    const before = JSON.stringify(buildArticlesFromTerms(T))
    const after = JSON.stringify(
      buildArticlesFromTerms({
        ...T,
        uniformSize: 'L',
        customTerms: [{ label: '수습기간', value: '3개월' }],
      })
    )
    expect(after).toBe(before)
  })

  it('임금 구성항목도 정본 본문을 바꾸지 않는다', () => {
    const before = JSON.stringify(buildArticlesFromTerms(T))
    const after = JSON.stringify(
      buildArticlesFromTerms({
        ...T,
        wageItems: [
          { name: '기본급', type: 'base', amount: 1900000 },
          { name: '고정연장수당', type: 'overtime_fixed', amount: 750000 },
        ],
      })
    )
    expect(after).toBe(before)
  })
})
