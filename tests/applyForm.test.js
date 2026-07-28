import { describe, it, expect } from 'vitest'
import { isApplyFormDirty } from '../src/lib/applyForm.js'

const EMPTY = {
  name: '',
  email: '',
  phone: '',
  source: '',
  coverLetter: '',
  careers: [],
  resume: null,
  portfolio: null,
}

describe('isApplyFormDirty', () => {
  it('아무것도 쓰지 않았으면 잃을 것이 없다', () => {
    expect(isApplyFormDirty(EMPTY)).toBe(false)
    expect(isApplyFormDirty(null)).toBe(false)
  })

  it('한 칸이라도 채웠으면 쓰다 만 것으로 본다', () => {
    expect(isApplyFormDirty({ ...EMPTY, name: '홍길동' })).toBe(true)
    expect(isApplyFormDirty({ ...EMPTY, coverLetter: '지원 동기는' })).toBe(true)
  })

  it('공백만 넣은 것은 쓴 것이 아니다', () => {
    expect(isApplyFormDirty({ ...EMPTY, name: '   ' })).toBe(false)
  })

  it('파일을 붙였으면 쓰다 만 것이다', () => {
    expect(isApplyFormDirty({ ...EMPTY, resume: { name: 'a.pdf' } })).toBe(true)
    expect(isApplyFormDirty({ ...EMPTY, portfolio: { name: 'b.pdf' } })).toBe(true)
  })

  it('경력 칸만 추가하고 비워 두었으면 잃을 것이 없다', () => {
    const blank = { employmentType: '', companyName: '', startDate: '', endDate: '', description: '' }
    expect(isApplyFormDirty({ ...EMPTY, careers: [blank] })).toBe(false)
  })

  it('경력을 한 칸이라도 채웠으면 쓰다 만 것이다', () => {
    const partial = { employmentType: '', companyName: '가나다', startDate: '', endDate: '' }
    expect(isApplyFormDirty({ ...EMPTY, careers: [partial] })).toBe(true)
  })

  it('동의만 눌러 둔 상태는 잃을 것이 없다', () => {
    expect(isApplyFormDirty({ ...EMPTY, consentRequired: true })).toBe(false)
  })

  it('이상한 경력 값이 섞여 있어도 무너지지 않는다', () => {
    expect(isApplyFormDirty({ ...EMPTY, careers: [null, undefined, '문자열'] })).toBe(false)
  })
})
