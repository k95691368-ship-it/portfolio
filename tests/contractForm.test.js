// 폼의 빈 상태와 '서버 값에서 폼 세우기'가 서로 다른 곳에 적혀 있었다.
// 그래서 한쪽에만 있는 항목이 생겼다 — 상시 근로자 수가 그랬다. 저장한 값이
// 화면에 다시 나타나지 않는데 판정은 그 값으로 돈다.
import { describe, expect, it } from 'vitest'
import { EMPTY_FORM, formFromTerms } from '../src/lib/contractForm.js'

describe('계약서 폼 세우기', () => {
  it('폼의 모든 항목이 서버 값에서 되살아난다 — 하나라도 빠지면 화면에서 사라진다', () => {
    const terms = Object.fromEntries(
      Object.entries(EMPTY_FORM).map(([k, v]) => [
        k,
        Array.isArray(v) ? [{ name: k }] : typeof v === 'object' ? { [k]: true } : `${k}-값`,
      ])
    )
    const form = formFromTerms(terms, [])
    for (const key of Object.keys(EMPTY_FORM)) {
      expect(form, `${key} 이 폼에서 빠졌다`).toHaveProperty(key)
      expect(form[key], `${key} 값이 서버 값과 다르다`).toEqual(terms[key])
    }
  })

  it('빈 계약서는 빈 상태와 같은 항목을 갖는다', () => {
    expect(Object.keys(formFromTerms(null, [])).sort()).toEqual(Object.keys(EMPTY_FORM).sort())
  })

  it('상시 근로자 수를 저장하면 화면에 다시 나타난다', () => {
    expect(formFromTerms({ employeeCount: 3 }, []).employeeCount).toBe(3)
  })

  it('아직 저장된 것이 없으면 당사자 이름을 참여자에서 채운다', () => {
    const form = formFromTerms(null, [
      { role: 'company', companyName: '가나회사', displayName: '김담당' },
      { role: 'candidate', displayName: '이지원' },
    ])
    expect(form.employerName).toBe('가나회사')
    expect(form.employeeName).toBe('이지원')
  })

  it('저장된 이름이 있으면 참여자 이름으로 덮지 않는다', () => {
    const form = formFromTerms({ employerName: '다른회사', employeeName: '다른사람' }, [
      { role: 'company', companyName: '가나회사' },
      { role: 'candidate', displayName: '이지원' },
    ])
    expect(form.employerName).toBe('다른회사')
    expect(form.employeeName).toBe('다른사람')
  })
})
