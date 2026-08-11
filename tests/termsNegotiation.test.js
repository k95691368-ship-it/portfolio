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

  // 콤마가 찍힌 만 단위를 앞뒤로 쪼개 각각 만을 곱해 더하고 있었다.
  // "1,234만원"이 235만원으로 기록됐다 — 실제의 5분의 1이다. 이 값은 나중에
  // "그때 얼마를 제시했는가"의 근거로 쓰이므로, 틀린 숫자가 남는 것은 아무것도
  // 남지 않는 것보다 나쁘다.
  it('콤마가 찍힌 만 단위를 쪼개지 않는다', () => {
    expect(read('급여 1,234만원')[0].value).toBe('12340000')
    expect(read('급여 1234만원')[0].value).toBe('12340000')
  })

  // 계약서의 wageBaseAmount 는 '월' 기본급이고, 최저임금 판정은 그것을 월
  // 소정근로시간으로 나눈다. 연봉을 그대로 넣으면 판정이 실제의 12배를 본다.
  it('천만·억 단위도 읽고, 연봉은 월액으로 옮긴다', () => {
    const [a] = read('연봉 3천만원')
    expect(a.value).toBe('2500000')
    expect(a.display).toBe('연봉 30,000,000원 (월 2,500,000원)')
    expect(read('연봉 1억 2천만원')[0].value).toBe('10000000')
  })

  it('월급은 그대로 읽는다', () => {
    expect(read('월급 3천만원')[0].value).toBe('30000000')
  })

  // 시급·일급을 월액으로 옮기려면 소정근로시간을 알아야 하는데 그 문장에는
  // 없다. 어림으로 환산한 월급이 근거로 남는 것보다 기록하지 않는 편이 낫다.
  it('시급·일급·주급은 기록하지 않는다', () => {
    expect(fieldsOf('시급은 1만 2천원입니다.')).not.toContain('wageBaseAmount')
    expect(fieldsOf('일급 15만원으로 하시죠.')).not.toContain('wageBaseAmount')
  })

  it('만 단위 아래로 떨어지는 값은 임금으로 보지 않는다', () => {
    // "3천 원"은 금액이지 급여가 아니다.
    expect(fieldsOf('급여는 3천 원입니다.')).not.toContain('wageBaseAmount')
  })

  it('만 단위 뒤에 붙는 천 단위도 더한다', () => {
    expect(read('임금 290만 5천원')[0].value).toBe('2905000')
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

// 워크플로우가 찾은 것들. 틀린 숫자가 남는 것은 아무것도 남지 않는 것보다 나쁘다.
describe('한 문장에 여러 금액이 있을 때', () => {
  // 문장 전체의 단위 표기를 모두 더해서 식대까지 임금에 합산됐다.
  it('부대비용을 임금에 더하지 않는다', () => {
    expect(read('기본급 290만원에 식대 10만원 별도 지급합니다.')[0].value).toBe('2900000')
  })

  it('먼저 말한 금액을 그 문장의 값으로 본다', () => {
    // 연봉 3,600만원을 12로 나눈 값. 뒤에 따라오는 "월 300만원"과 같아진다.
    expect(read('연봉 3,600만원이면 월 300만원 수준입니다.')[0].value).toBe('3000000')
  })

  it('붙어 있는 단위 표기는 한 금액이다', () => {
    const [e] = read('연봉 1억 2천만원입니다.')
    expect(e.display).toBe('연봉 120,000,000원 (월 10,000,000원)')
  })
})

describe('오전·오후', () => {
  // 9시간 근무가 이력상 하루 -3시간으로 남았다.
  it('오후 표기를 생략해도 뒤 시각을 오후로 읽는다', () => {
    expect(read('근무시간은 9시부터 6시까지입니다.')[0].value).toBe('09:00~18:00')
    expect(read('출퇴근은 8시부터 5시까지입니다.')[0].value).toBe('08:00~17:00')
  })

  it('오전·오후를 명시해도 읽는다', () => {
    expect(read('근무시간은 오전 9시부터 오후 6시까지입니다.')[0].value).toBe('09:00~18:00')
  })
})

describe('근무시간이 아닌 시각', () => {
  // 휴게시간 안내 한 줄이 합의된 근무시간을 갈아치웠다.
  it('휴게시간을 근무시간으로 기록하지 않는다', () => {
    expect(fieldsOf('점심 휴게시간은 12시부터 13시까지입니다.')).not.toContain('workHours')
  })

  it('전화번호를 시각으로 읽지 않는다', () => {
    expect(fieldsOf('근무시간 관련 문의는 010-1234-5678로 주세요.')).not.toContain('workHours')
  })
})

describe('연도를 말하지 않은 날짜', () => {
  const NOW = new Date(Date.UTC(2026, 7, 10)) // 2026-08-10
  const readAt = (body, now = NOW) => extractTermsFromMessage({ body }, { now })

  it('내년이라고 하면 내년으로 읽는다', () => {
    expect(readAt('입사는 내년 3월 2일로 하시죠.')[0].value).toBe('2027-03-02')
  })

  it('두 자리 연도를 읽는다', () => {
    expect(readAt('출근은 27년 3월 2일부터입니다.')[0].value).toBe('2027-03-02')
  })

  // 근로개시일을 이미 지난 날로 정하지는 않는다.
  it('이미 지난 달을 말하면 내년으로 읽는다', () => {
    expect(readAt('입사일은 3월 2일입니다.')[0].value).toBe('2027-03-02')
  })

  it('아직 오지 않은 달은 올해로 읽는다', () => {
    expect(readAt('입사일은 9월 1일입니다.')[0].value).toBe('2026-09-01')
  })

  // 서버는 UTC 라 한국시간 새벽에는 해가 다르다.
  it('연말에 1월 입사를 말하면 내년이다', () => {
    const 연말 = new Date(Date.UTC(2026, 11, 20))
    expect(readAt('입사일은 1월 5일로 하겠습니다.', 연말)[0].value).toBe('2027-01-05')
  })
})

describe('쉬는 날', () => {
  it('휴무 안내를 근무일로 기록하지 않는다', () => {
    expect(fieldsOf('근무일은 주말은 쉽니다. 토~일은 휴무입니다.')).not.toContain('workDays')
  })
})

// 경계값. 근로개시일과 근무시간은 그 위에서 모든 법정 계산이 돈다.
describe('시각의 경계', () => {
  it('자정을 넘기는 교대를 버리지 않는다', () => {
    // 예전에는 종료가 시작보다 작으면 무조건 오후로 밀었다가, 그래도 작으면
    // 통째로 버렸다. 야간 교대가 아예 기록되지 않았다.
    expect(read('근무시간은 22시부터 6시까지입니다.')[0].value).toBe('22:00~06:00')
    expect(read('근무시간은 오후 10시부터 오전 6시까지')[0].value).toBe('22:00~06:00')
  })

  it('시작과 끝이 같으면 모르는 것으로 둔다', () => {
    // "09:00부터 09:00까지"가 9시간으로 읽혔다.
    expect(fieldsOf('근무시간은 09:00부터 09:00까지')).not.toContain('workHours')
  })
})

describe('금액과 날짜의 경계', () => {
  it('음수 금액은 임금이 아니다', () => {
    expect(fieldsOf('급여는 -100만원')).not.toContain('wageBaseAmount')
  })

  // 연도를 추론하다 보면 윤년이 아닌 해의 2월 29일이 만들어진다.
  it('달력에 없는 날은 기록하지 않는다', () => {
    const NOW = new Date(Date.UTC(2026, 7, 10))
    expect(
      extractTermsFromMessage({ body: '입사일은 2월 29일입니다' }, { now: NOW }).map((e) => e.field)
    ).not.toContain('contractStartDate')
    // 진짜 윤년은 그대로 읽는다.
    expect(
      extractTermsFromMessage({ body: '입사일은 2028-02-29 입니다' }, { now: NOW })[0].value
    ).toBe('2028-02-29')
  })
})

// 값이 어느 문장에 있었는지가 곧 그 값이 무엇에 대한 값인지다.
// 메시지를 한 덩어리로 읽으면 주제와 값이 서로 다른 문장에서 묶인다.
describe('여러 문장이 섞인 메시지', () => {
  it('다른 문장의 날짜를 근로개시일로 가져오지 않는다', () => {
    expect(fieldsOf('면접은 8월 20일입니다. 출근일은 추후 안내드립니다.')).not.toContain(
      'contractStartDate'
    )
  })

  it('뒤 문장의 휴게시간 안내가 앞 문장의 근무시간을 버리게 하지 않는다', () => {
    const [e] = read('근무시간은 9시부터 18시까지입니다. 점심 휴게는 12시~13시입니다.')
    expect(e.field).toBe('workHours')
    expect(e.value).toBe('09:00~18:00')
  })

  it('근거로 남기는 인용문은 그 값을 말한 문장이다', () => {
    const [e] = read('안녕하세요. 기본급은 290만원입니다. 확인 부탁드립니다.')
    expect(e.excerpt).toBe('기본급은 290만원입니다.')
  })

  it('같은 항목을 되풀이해도 한 번만 기록한다', () => {
    const entries = read('급여는 290만원입니다. 급여는 290만원으로 하시죠.')
    expect(entries.filter((e) => e.field === 'wageBaseAmount')).toHaveLength(1)
  })

  // 날짜의 하이픈을 음수 부호로 읽어, 날짜를 함께 말한 문장에서는 임금이
  // 통째로 사라졌다.
  it('날짜와 임금을 한 문장에서 말해도 임금을 읽는다', () => {
    const entries = read('입사일은 2026-09-01이고 급여는 290만원입니다.')
    expect(entries.find((e) => e.field === 'wageBaseAmount')?.value).toBe('2900000')
    expect(entries.find((e) => e.field === 'contractStartDate')?.value).toBe('2026-09-01')
  })

  it('그래도 음수 금액은 임금이 아니다', () => {
    expect(fieldsOf('급여는 -100만원')).not.toContain('wageBaseAmount')
    expect(fieldsOf('급여 조정: -50만원')).not.toContain('wageBaseAmount')
  })
})

// 시작이 오후로 보정된 뒤에 종료 보정 조건이 깨져, 오후 근무가 자정을 넘기는
// 근무로 읽혔다. 그 값 위에서 제53조(주 52시간) 판정이 돈다.
describe('오후에 시작하는 근무', () => {
  it('오후 1시부터 6시까지는 5시간이다', () => {
    expect(read('근무시간은 오후 1시부터 6시까지입니다.')[0].value).toBe('13:00~18:00')
  })

  it('야간 교대는 그대로 자정을 넘긴다', () => {
    expect(read('근무시간은 밤 10시부터 6시까지입니다.')[0].value).toBe('22:00~06:00')
    expect(read('근무시간은 22시부터 6시까지입니다.')[0].value).toBe('22:00~06:00')
  })

  it('하루에 그럴 리 없는 길이는 잘못 읽은 것으로 본다', () => {
    // 오전 5시부터 밤 11시까지 = 18시간. 합의된 소정근로시간일 수 없다.
    expect(fieldsOf('근무시간은 오전 5시부터 밤 11시까지입니다.')).not.toContain('workHours')
  })
})
