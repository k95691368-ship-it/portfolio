// 처우 협의 조건을 대화에서 계속 읽어 기록한다.
//
// 근로조건은 계약서에 적히기 전에 대화에서 먼저 정해진다. 나중에 회사가
// "그렇게 말한 적 없다"고 할 때 필요한 것은 채팅 로그 전체가 아니라
// "언제 누가 무엇을 말했는가"다.
import { describe, expect, it } from 'vitest'
import {
  extractTermsFromMessage,
  selectNewEntries,
  describeNegotiation,
} from '../functions/_lib/termsNegotiation.js'

const read = (body) => extractTermsFromMessage({ body }, { year: 2026 })
const fieldsOf = (body) => read(body).map((e) => e.field)

describe('대화에서 처우 조건 읽기', () => {
  it('임금을 만 단위로 말해도 원으로 읽는다', () => {
    const [e] = read('기본급은 월 290만원으로 책정했습니다.')
    expect(e.field).toBe('wageBaseAmount')
    expect(e.value).toBe('2900000')
    expect(e.display).toBe('2,900,000원')
  })

  it('콤마가 붙은 금액도 읽는다', () => {
    const [e] = read('급여는 2,500,000원입니다.')
    expect(e.value).toBe('2500000')
  })

  // 숫자만 보고 값을 뽑으면 "290만원짜리 장비"가 임금으로 기록된다.
  it('임금 이야기가 아니면 금액을 임금으로 읽지 않는다', () => {
    expect(fieldsOf('290만원짜리 장비를 지급합니다.')).not.toContain('wageBaseAmount')
  })

  it('근로개시일을 읽는다', () => {
    const [e] = read('근로개시일은 9월 1일로 하겠습니다.')
    expect(e.field).toBe('contractStartDate')
    expect(e.value).toBe('2026-09-01')
  })

  it('연월일이 다 적힌 날짜도 읽는다', () => {
    const [e] = read('입사일은 2027-03-02 입니다.')
    expect(e.value).toBe('2027-03-02')
  })

  it('근무시간을 읽는다', () => {
    const [e] = read('근무시간은 09시부터 18시까지입니다.')
    expect(e.field).toBe('workHours')
    expect(e.value).toBe('09:00~18:00')
  })

  it('근무일을 읽는다', () => {
    const [e] = read('근무일은 주 5일입니다.')
    expect(e.field).toBe('workDays')
    expect(e.value).toBe('주 5일')
  })

  it('한 문장에 여러 조건이 있으면 모두 뽑는다', () => {
    const fields = fieldsOf('근무시간은 09시부터 18시까지 주 5일이고, 기본급은 290만원입니다.')
    expect(fields).toContain('workHours')
    expect(fields).toContain('workDays')
    expect(fields).toContain('wageBaseAmount')
  })

  it('조건이 없는 말에서는 아무것도 뽑지 않는다', () => {
    expect(read('안녕하세요, 잘 부탁드립니다.')).toEqual([])
    expect(read('')).toEqual([])
  })
})

describe('바뀐 것만 남긴다', () => {
  // 같은 값을 여러 번 말하는 것은 협의의 진전이 아니다. 그대로 쌓으면
  // 정작 바뀐 지점이 같은 줄에 묻힌다.
  it('직전 값과 같으면 남기지 않는다', () => {
    const extracted = read('기본급은 290만원입니다.')
    expect(selectNewEntries(extracted, { wageBaseAmount: '2900000' })).toHaveLength(0)
  })

  it('값이 달라지면 남기고 이전 값을 함께 적는다', () => {
    const extracted = read('기본급은 260만원으로 조정하겠습니다.')
    const [e] = selectNewEntries(extracted, { wageBaseAmount: '2900000' })
    expect(e.value).toBe('2600000')
    expect(e.previousValue).toBe('2900000')
  })

  it('처음 나온 항목은 이전 값이 없다', () => {
    const [e] = selectNewEntries(read('급여는 290만원입니다.'), {})
    expect(e.previousValue).toBeNull()
  })
})

describe('이력 정리', () => {
  const rows = [
    { created_at: '2026-08-01 10:00:00', field: 'wageBaseAmount', label: '임금', speaker_role: 'company', value_display: '2,900,000원', excerpt: 'a' },
    { created_at: '2026-08-01 11:00:00', field: 'wageBaseAmount', label: '임금', speaker_role: 'candidate', value_display: '3,100,000원', previous_value: '2900000', excerpt: 'b' },
    { created_at: '2026-08-01 12:00:00', field: 'workDays', label: '근무일', speaker_role: 'company', value_display: '주 5일', excerpt: 'c' },
  ]

  it('전체 이력과 항목별 최신값을 함께 준다', () => {
    const d = describeNegotiation(rows)
    expect(d.count).toBe(3)
    expect(d.latest).toHaveLength(2)
    expect(d.latest.find((e) => e.field === 'wageBaseAmount').value).toBe('3,100,000원')
  })

  it('누가 말한 값인지 남는다 — 구분하지 않으면 합의의 근거가 못 된다', () => {
    const d = describeNegotiation(rows)
    expect(d.entries[0].role).toBe('company')
    expect(d.entries[1].role).toBe('candidate')
  })

  it('기록이 없으면 비어 있다', () => {
    expect(describeNegotiation([]).count).toBe(0)
    expect(describeNegotiation(undefined).count).toBe(0)
  })
})
