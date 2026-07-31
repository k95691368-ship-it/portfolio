import { describe, it, expect } from 'vitest'
import { seedTermsFromApplication, hasSeedValues } from '../functions/_lib/seedTerms.js'

const POSTING = {
  title: 'AX 프로젝트 매니저',
  department: '전략기획팀',
  location: '서울 본사',
  employment_type: '정규직',
}
const APPLICATION = { applicant_name: '홍길동' }
const COMPANY = { company_name: '주식회사 포오스', display_name: '김담당' }

describe('seedTermsFromApplication', () => {
  it('지원서와 공고에서 계약 출발점을 만든다', () => {
    const seed = seedTermsFromApplication({
      posting: POSTING,
      application: APPLICATION,
      companyUser: COMPANY,
    })
    expect(seed).toEqual({
      employerName: '주식회사 포오스',
      employeeName: '홍길동',
      workLocation: '서울 본사',
      jobDescription: 'AX 프로젝트 매니저 · 전략기획팀',
    })
  })

  it('상호가 없으면 표시 이름을 쓴다', () => {
    const seed = seedTermsFromApplication({
      posting: POSTING,
      application: APPLICATION,
      companyUser: { display_name: '김담당' },
    })
    expect(seed.employerName).toBe('김담당')
  })

  it('부서가 없으면 공고 제목만 쓴다', () => {
    const seed = seedTermsFromApplication({
      posting: { ...POSTING, department: null },
      application: APPLICATION,
      companyUser: COMPANY,
    })
    expect(seed.jobDescription).toBe('AX 프로젝트 매니저')
  })

  // 빈 문자열은 findMissingFields를 통과해 "채워졌다"고 잘못 읽힌다.
  it('빈 값은 빈 문자열이 아니라 null로 둔다', () => {
    const seed = seedTermsFromApplication({
      posting: { title: '', department: '   ', location: '' },
      application: { applicant_name: '  ' },
      companyUser: {},
    })
    expect(seed.employerName).toBeNull()
    expect(seed.employeeName).toBeNull()
    expect(seed.workLocation).toBeNull()
    expect(seed.jobDescription).toBeNull()
  })

  it('앞뒤 공백을 정리한다', () => {
    const seed = seedTermsFromApplication({
      posting: { title: ' 매니저 ', location: ' 서울 ' },
      application: { applicant_name: ' 홍길동 ' },
      companyUser: { company_name: ' 포오스 ' },
    })
    expect(seed.employeeName).toBe('홍길동')
    expect(seed.workLocation).toBe('서울')
    expect(seed.employerName).toBe('포오스')
    expect(seed.jobDescription).toBe('매니저')
  })

  it('아무것도 없어도 무너지지 않는다', () => {
    const seed = seedTermsFromApplication()
    expect(seed.employerName).toBeNull()
    expect(seed.employeeName).toBeNull()
  })
})

describe('hasSeedValues', () => {
  it('하나라도 값이 있으면 참', () => {
    expect(hasSeedValues({ employerName: '포오스', employeeName: null })).toBe(true)
  })
  it('전부 비었으면 거짓', () => {
    expect(hasSeedValues({ employerName: null, employeeName: null })).toBe(false)
    expect(hasSeedValues({})).toBe(false)
    expect(hasSeedValues(null)).toBe(false)
  })
})
