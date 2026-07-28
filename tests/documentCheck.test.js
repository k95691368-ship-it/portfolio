import { describe, it, expect } from 'vitest'
import {
  containsToken,
  amountVariants,
  dateVariants,
  timeVariants,
  findStatedBaseWage,
  checkDocumentConsistency,
  checkRequiredArticles,
  checkContractDocument,
} from '../functions/_lib/documentCheck.js'

const TERMS = {
  employerName: '주식회사 테스트',
  employeeName: '홍길동',
  workLocation: '서울시 강남구 본사',
  jobDescription: '고객 응대 및 매장 관리',
  contractStartDate: '2026-09-01',
  contractEndDate: '2027-08-31',
  workHoursStart: '09:00',
  workHoursEnd: '18:00',
  workDays: '주 5일 (월~금)',
  restDays: '토요일, 일요일',
  wageBaseAmount: '3200000',
  wagePayDate: '매월 25일',
  annualLeave: '근로기준법에 따름',
}

// 조건과 완전히 일치하는 정상 본문
const GOOD_ARTICLES = [
  { heading: '제1조 (근로계약기간)', body: '2026년 9월 1일부터 2027년 8월 31일까지로 한다.' },
  { heading: '제2조 (근무장소)', body: '서울시 강남구 본사로 한다.' },
  { heading: '제3조 (업무의 내용)', body: '고객 응대 및 매장 관리 업무를 담당한다.' },
  { heading: '제4조 (소정근로시간)', body: '09:00부터 18:00까지로 하며, 휴게시간 1시간을 부여한다.' },
  { heading: '제5조 (근무일 및 휴일)', body: '주 5일(월~금) 근무하며 토요일, 일요일을 휴일로 한다.' },
  { heading: '제6조 (임금)', body: '기본급 3,200,000원을 매월 25일에 지급한다.' },
  { heading: '제7조 (연차유급휴가)', body: '연차유급휴가는 근로기준법에 따라 부여한다.' },
  { heading: '제8조 (당사자)', body: '사업주 주식회사 테스트, 근로자 홍길동' },
]

describe('containsToken', () => {
  it('앞뒤에 다른 숫자가 붙으면 일치로 보지 않는다', () => {
    expect(containsToken('19시부터', '9시')).toBe(false)
    expect(containsToken('9시부터', '9시')).toBe(true)
    expect(containsToken('13200000원', '3200000')).toBe(false)
    expect(containsToken('3200000원', '3200000')).toBe(true)
  })
})

describe('표기 변형', () => {
  it('금액은 만 단위 표기도 인정한다', () => {
    expect(amountVariants('3200000')).toEqual(['3200000', '320만'])
    expect(amountVariants('3215000')).toEqual(['3215000'])
    expect(amountVariants('0')).toEqual([])
  })

  it('날짜는 한글·점·슬래시 표기를 모두 만든다', () => {
    const v = dateVariants('2026-09-01')
    expect(v).toContain('2026년9월1일')
    expect(v).toContain('2026.09.01')
    expect(v).toContain('2026/9/1')
  })

  it('시각은 오전·오후 표기를 포함한다', () => {
    expect(timeVariants('09:00')).toContain('오전9시')
    expect(timeVariants('18:00')).toContain('오후6시')
    expect(timeVariants('09:30')).toContain('9:30')
    expect(timeVariants('09:30')).not.toContain('9시')
  })
})

describe('checkDocumentConsistency', () => {
  it('본문과 조건이 일치하면 문제가 없다', () => {
    expect(checkDocumentConsistency(GOOD_ARTICLES, TERMS)).toEqual([])
  })

  it('만원 표기로 쓴 임금도 일치로 인정한다', () => {
    const articles = GOOD_ARTICLES.map((a) =>
      a.heading.includes('임금') ? { ...a, body: '기본급 320만원을 매월 25일에 지급한다.' } : a
    )
    expect(checkDocumentConsistency(articles, TERMS)).toEqual([])
  })

  it('조건만 바뀌고 본문이 낡으면 임금 불일치를 잡아낸다', () => {
    // 회사가 기본급을 250만원으로 내렸지만 본문은 320만원 그대로인 상황
    const staleTerms = { ...TERMS, wageBaseAmount: '2500000' }
    const issues = checkDocumentConsistency(GOOD_ARTICLES, staleTerms)
    const wage = issues.find((i) => i.field === 'wageBaseAmount')
    expect(wage).toBeTruthy()
    expect(wage.severity).toBe('high')
    expect(wage.conflict).toBe(true)
    expect(wage.expected).toBe('2,500,000원')
    expect(wage.stated).toBe('3,200,000원')
  })

  it('본문에 없는 날짜·시각도 잡아낸다', () => {
    const changed = { ...TERMS, contractStartDate: '2026-10-01', workHoursStart: '07:00' }
    const fields = checkDocumentConsistency(GOOD_ARTICLES, changed).map((i) => i.field)
    expect(fields).toContain('contractStartDate')
    expect(fields).toContain('workHoursStart')
  })

  it('식대 같은 다른 금액을 기본급으로 오인하지 않는다', () => {
    const articles = [
      { heading: '제1조 (임금)', body: '기본급 3,200,000원과 별도로 식대 200,000원을 지급한다.' },
    ]
    const issues = checkDocumentConsistency(articles, {
      wageBaseAmount: '3200000',
    })
    expect(issues).toEqual([])
  })

  it('본문이 없으면 점검하지 않는다', () => {
    expect(checkDocumentConsistency([], TERMS)).toEqual([])
    expect(checkDocumentConsistency(null, TERMS)).toEqual([])
  })

  it('비어 있는 조건은 대조 대상이 아니다', () => {
    const issues = checkDocumentConsistency(GOOD_ARTICLES, { ...TERMS, contractEndDate: '' })
    expect(issues).toEqual([])
  })
})

describe('findStatedBaseWage', () => {
  it('기본급 뒤의 금액을 읽는다', () => {
    expect(findStatedBaseWage('기본급3200000원식대200000원')).toBe(3200000)
    expect(findStatedBaseWage('기본급320만원')).toBe(3200000)
    expect(findStatedBaseWage('기본급은월2400000원으로한다')).toBe(2400000)
  })

  it('금액이 기본급 표현보다 앞에 와도 읽는다', () => {
    expect(findStatedBaseWage('월2156880원을기본급으로지급한다')).toBe(2156880)
  })

  it('기본급이 아닌 것이 분명한 금액은 건너뛴다', () => {
    expect(findStatedBaseWage('식대200000원')).toBe(null)
    expect(findStatedBaseWage('식대200000원과기타수당300000원')).toBe(null)
    expect(findStatedBaseWage('식대200000원외에월2400000원을지급한다')).toBe(2400000)
  })

  it('본문이 비면 아무것도 읽지 않는다', () => {
    expect(findStatedBaseWage('')).toBe(null)
  })
})

describe('임금 조항이 아닌 곳의 금액', () => {
  it('다른 조항의 금액을 기본급으로 오인하지 않는다', () => {
    const articles = [
      { heading: '제1조 (임금)', body: '월 2,400,000원을 지급한다.' },
      { heading: '제2조 (교육비)', body: '교육비로 연 5,000,000원을 지원한다.' },
    ]
    const issues = checkDocumentConsistency(articles, { wageBaseAmount: '2900000' })
    expect(issues[0].stated).toBe('2,400,000원')
  })
})

describe('checkRequiredArticles', () => {
  it('표준 계약서 본문에는 빠진 조항이 없다', () => {
    expect(checkRequiredArticles(GOOD_ARTICLES)).toEqual([])
  })

  it('연차·휴일 조항이 빠지면 잡아낸다', () => {
    const partial = GOOD_ARTICLES.filter(
      (a) => !a.heading.includes('연차') && !a.heading.includes('휴일')
    )
    const keys = checkRequiredArticles(partial).map((m) => m.key)
    expect(keys).toContain('leave')
    expect(keys).toContain('holiday')
    expect(keys).not.toContain('wage')
  })
})

describe('checkContractDocument', () => {
  it('AI 본문이 없으면 점검 대상이 아니다', () => {
    const r = checkContractDocument({ ...TERMS, aiDocument: null })
    expect(r.hasDocument).toBe(false)
    expect(r.hasConflict).toBe(false)
  })

  it('본문이 있으면 정합성과 필수 조항을 함께 본다', () => {
    const r = checkContractDocument({ ...TERMS, aiDocument: GOOD_ARTICLES })
    expect(r.hasDocument).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.missingArticles).toEqual([])
  })

  it('임금이 어긋나면 hasConflict가 켜진다', () => {
    const r = checkContractDocument({
      ...TERMS,
      wageBaseAmount: '2500000',
      aiDocument: GOOD_ARTICLES,
    })
    expect(r.hasConflict).toBe(true)
  })
})
