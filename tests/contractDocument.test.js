import { describe, it, expect } from 'vitest'
import { canonicalizeContract, contractFingerprint } from '../functions/_lib/contractDocument.js'

const TERMS = {
  employerName: '주식회사 테스트',
  employeeName: '홍길동',
  workLocation: '서울 본사',
  jobDescription: '운영',
  contractStartDate: '2026-09-01',
  contractEndDate: '2027-08-31',
  workHoursStart: '09:00',
  workHoursEnd: '18:00',
  workDays: '주 5일 (월~금)',
  restDays: '토요일, 일요일',
  wageBaseAmount: 3200000,
  wagePayMethod: '계좌이체',
  wagePayDate: '매월 25일',
  annualLeave: '근로기준법에 따름',
  socialInsurance: { employment_insurance: true, health_insurance: true },
  customTerms: [
    { label: '식대', value: '월 20만원' },
    { label: '교통비', value: '실비' },
  ],
}

describe('canonicalizeContract', () => {
  it('같은 내용이면 같은 문자열이 나온다', () => {
    expect(canonicalizeContract(TERMS)).toBe(canonicalizeContract({ ...TERMS }))
  })

  it('키 순서가 달라도 같은 문자열이 나온다', () => {
    const reordered = {}
    for (const key of Object.keys(TERMS).reverse()) reordered[key] = TERMS[key]
    expect(canonicalizeContract(reordered)).toBe(canonicalizeContract(TERMS))
  })

  it('그 밖의 사항은 입력 순서가 달라도 같게 본다', () => {
    const swapped = { ...TERMS, customTerms: [...TERMS.customTerms].reverse() }
    expect(canonicalizeContract(swapped)).toBe(canonicalizeContract(TERMS))
  })

  it('값이 하나라도 다르면 문자열이 달라진다', () => {
    expect(canonicalizeContract({ ...TERMS, wageBaseAmount: 3200001 })).not.toBe(
      canonicalizeContract(TERMS)
    )
    expect(canonicalizeContract({ ...TERMS, restDays: '일요일' })).not.toBe(
      canonicalizeContract(TERMS)
    )
  })

  it('본문이 다르면 문자열이 달라진다', () => {
    const withBody = {
      ...TERMS,
      aiDocument: [{ heading: '제1조', body: '기본급 3,200,000원' }],
    }
    const changedBody = {
      ...TERMS,
      aiDocument: [{ heading: '제1조', body: '기본급 2,500,000원' }],
    }
    expect(canonicalizeContract(withBody)).not.toBe(canonicalizeContract(changedBody))
  })

  it('본문이 없으면 조건에서 만든 조항을 넣는다', () => {
    const text = canonicalizeContract(TERMS)
    expect(text).toContain('[본문]')
    expect(text).toContain('제1조')
  })

  it('빈 값과 없는 값을 같게 본다', () => {
    expect(canonicalizeContract({ ...TERMS, uniformSize: null })).toBe(
      canonicalizeContract({ ...TERMS, uniformSize: '' })
    )
  })

  it('값이 없어도 무너지지 않는다', () => {
    expect(typeof canonicalizeContract(null)).toBe('string')
    expect(canonicalizeContract({})).toContain('[계약조건]')
  })
})

describe('contractFingerprint', () => {
  it('SHA-256 16진 64자를 돌려준다', async () => {
    const hash = await contractFingerprint(TERMS)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('같은 내용은 같은 지문', async () => {
    expect(await contractFingerprint(TERMS)).toBe(await contractFingerprint({ ...TERMS }))
  })

  it('한 글자만 달라도 지문이 바뀐다', async () => {
    const a = await contractFingerprint(TERMS)
    const b = await contractFingerprint({ ...TERMS, workLocation: '서울 본사 ' + '2' })
    expect(a).not.toBe(b)
  })
})
