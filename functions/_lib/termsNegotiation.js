// 처우 협의 조건을 대화에서 계속 읽어 기록한다 (순수 함수 — 단위 테스트 대상).
//
// 근로조건은 계약서에 적히기 전에 대화에서 먼저 정해진다. 그런데 그 과정은
// 어디에도 남지 않았다. 계약서 수정 이력은 계약서를 고친 뒤부터의 이야기이고,
// 그 앞에서 무엇을 제시하고 무엇을 받아들였는지는 채팅 로그 수백 줄 안에
// 흩어져 있다.
//
// 그것이 남아야 하는 이유는 둘이다.
//
//   채용내정이 성립했는지 판단하려면 "무엇을 약속했는가"가 있어야 한다.
//   조건 없이 "합격입니다"만으로는 계약 내용이 특정되지 않는다.
//
//   확정 뒤에 조건이 불리하게 바뀌었는지 따지려면 기준이 있어야 한다. 회사가
//   "원래 그렇게 말한 적 없다"고 하면, 대화에 있었다는 사실만으로는 부족하고
//   언제 누가 무엇을 말했는지가 필요하다.
//
// AI 가 아니라 코드가 읽는다. AI 조건 정리는 회사가 버튼을 눌러야 돌고,
// 크레딧이 없으면 아예 돌지 않는다. 협의는 그동안에도 계속 진행된다.
// 그리고 이 기록은 나중에 근거로 쓰이므로 재현되어야 한다 — 같은 문장에서
// 오늘과 내일 다른 값이 나오면 근거가 될 수 없다.

import { koreanToday } from './koreanTime.js'

const MAX_EXCERPT = 200

function excerpt(body) {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim()
  return text.length > MAX_EXCERPT ? `${text.slice(0, MAX_EXCERPT)}…` : text
}

// "290만원", "2,900,000원", "1,234만원", "3천만원", "1억 2천만원", "290만 5천원"
//
// 처음에는 콤마가 찍힌 만 단위를 앞뒤로 쪼개 각각 만을 곱해 더했다. 그래서
// "1,234만원"이 1×10000 + 234×10000 = 235만원으로 기록됐다. 실제의 5분의 1이다.
// 이 값은 나중에 "그때 얼마를 제시했는가"의 근거로 쓰인다. 틀린 숫자가 남는
// 것은 아무것도 남지 않는 것보다 나쁘다.
//
// 세 자리마다 찍은 콤마를 먼저 지우고, 단위가 붙은 표기는 단위끼리 곱해 더한다.
const SCALE = { 억: 100000000, 천만: 10000000, 만: 10000, 천: 1000 }

function parseWon(text) {
  const raw = String(text ?? '')
  // 음수 금액은 임금이 아니다. 부호를 무시하면 "-100만원"이 100만원이 된다.
  //
  // 다만 '-' 하나만 보고 문장 전체를 버리면 안 된다. "입사일은 2026-09-01이고
  // 급여는 290만원입니다"의 날짜에도 '-' 가 있어서, 날짜를 함께 말한 문장에서는
  // 임금이 통째로 읽히지 않았다. 부호는 숫자 앞에 홀로 설 때만 부호다.
  if (/(?:^|[\s(=:])[-−]\s*\d/.test(raw)) return null
  const t = raw.replace(/(\d),(?=\d{3}(?!\d))/g, '$1')

  // 한 금액의 자릿수를 합치는 것과, 문장 안의 서로 다른 금액을 더하는 것은
  // 다르다. 처음에는 문장 전체의 단위 표기를 모두 더해서
  // "기본급 290만원에 식대 10만원 별도"가 300만원으로 기록됐다.
  //
  // 붙어 있는 단위 표기만 한 덩어리로 본다. "1억 2천만원"은 이어져 있으므로
  // 한 금액이고, "290만원 ... 10만원"은 사이에 다른 말이 끼므로 두 금액이다.
  const groups = [...t.matchAll(/(?:\d+\s*(?:억|천만|만|천)\s*)+/g)]
  for (const g of groups) {
    let total = 0
    for (const m of g[0].matchAll(/(\d+)\s*(억|천만|만|천)/g)) {
      const n = Number(m[1])
      const scale = SCALE[m[2]]
      if (Number.isFinite(n) && scale) total += n * scale
    }
    // 만 단위에 못 미치는 값은 임금으로 보지 않는다. "3천 원"은 금액이지
    // 급여가 아니다. 첫 번째로 나오는 금액을 쓴다 — 문장에서 먼저 말한 것이
    // 그 문장이 정하려는 값이다.
    if (total >= 10000) return total
  }

  const plain = t.match(/(\d{6,12})\s*원/)
  if (plain) {
    const n = Number(plain[1])
    if (Number.isFinite(n) && n >= 100000) return n
  }
  return null
}

// "9월 1일", "2026-09-01", "2026년 9월 1일", "27년 3월 2일", "내년 3월 2일"
//
// 연도를 안 적은 날짜를 무조건 올해로 붙이고 있었다. 그래서 "내년 3월 2일"이
// 이미 지나간 올해 3월로 기록되고, 12월에 "1월 5일 입사"로 합의하면 11개월
// 과거가 된다. 근로개시일은 채용내정 성립과 불이익 변경(개시일 연기)을 따지는
// 값이라, 연도가 통째로 틀린 값이 근거로 남는다.
//
// 기준일은 한국 날짜로 잡는다. 서버는 UTC 라 한국시간 새벽에는 해가 다르다.
// 달력에 없는 날은 날짜가 아니다. 연도를 추론하다 보면 윤년이 아닌 해의
// 2월 29일 같은 것이 만들어진다 — 그대로 기록하면 근로개시일이 존재하지 않는
// 날이 되고, 그것을 기준으로 도는 모든 계산이 함께 어긋난다.
function isRealDate(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day))
  return (
    d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
  )
}

function isoOrNull(year, month, day) {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (!isRealDate(y, m, d)) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseDate(text, options = {}) {
  const base = options.today ?? koreanToday(options.now ?? new Date())
  const baseYear = options.year ?? base.getUTCFullYear()

  const iso = text.match(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/)
  if (iso) {
    const [, y, m, d] = iso
    return isoOrNull(y, m, d)
  }

  // "27년 3월 2일" 처럼 두 자리로 적은 연도.
  const short = text.match(/(?<!\d)(\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (short) {
    const [, y, m, d] = short
    return isoOrNull(`20${y}`, m, d)
  }

  const md = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (md) {
    const [, m, d] = md
    let year = baseYear
    if (/내년|다음\s*해|익년/.test(text)) year += 1
    else if (/작년|지난\s*해/.test(text)) year -= 1
    else if (options.year === undefined) {
      // 연도를 말하지 않았다면 앞으로 올 날을 뜻한다. 근로개시일은 과거로
      // 정하지 않는다 — 이미 지난 달을 말했으면 내년으로 읽는다.
      const asThisYear = Date.UTC(year, Number(m) - 1, Number(d))
      if (asThisYear < base.getTime()) year += 1
    }
    return isoOrNull(year, m, d)
  }
  return null
}

// "09시부터 18시까지", "9시~18시", "09:00 ~ 18:00", "오전 9시부터 오후 6시까지"
//
// 오전·오후를 몰라서 "9시부터 6시까지"가 09:00~06:00 으로 기록됐다. 9시간
// 근무가 이력상 하루 -3시간이 되고, 이 값은 제53조 연장근로 판단의 기준이다.
// 반대로 "오전 9시부터 오후 6시까지"는 구분자 뒤에 곧바로 숫자를 요구해
// 아예 매치되지 않았다.
//
// 오전·오후가 없으면 종료가 시작보다 앞설 때 오후로 읽는다. 근로계약에서
// 자정을 넘겨 되돌아오는 근무보다 오후 표기를 생략한 경우가 압도적으로 흔하다.
// 전화번호(010-1234-5678)가 시각으로 읽히지 않도록 '-'는 구분자에서 뺐다.
function parseHours(text) {
  const m = text.match(
    /(오전|오후|아침|저녁|밤)?\s*(\d{1,2})\s*(?::(\d{2}))?\s*시?\s*(?:부터|~|에서)\s*(오전|오후|아침|저녁|밤)?\s*(\d{1,2})\s*(?::(\d{2}))?\s*시?\s*(?:까지)?/
  )
  if (!m) return null
  const [, sMeri, sh, sm, eMeri, eh, em] = m

  const toHour = (raw, meri) => {
    let h = Number(raw)
    if (!Number.isFinite(h) || h < 0 || h > 24) return null
    if ((meri === '오후' || meri === '저녁' || meri === '밤') && h < 12) h += 12
    if ((meri === '오전' || meri === '아침') && h === 12) h = 0
    return h
  }

  const s = toHour(sh, sMeri)
  let e = toHour(eh, eMeri)
  if (s === null || e === null) return null

  // 시작과 끝이 같으면 근무시간을 알 수 없는 것이지 0시간도 24시간도 아니다.
  // 보정보다 먼저 걸러야 한다 — "09:00부터 09:00까지"가 9시간으로 읽혔다.
  if (s === e && !sMeri && !eMeri) return null

  if (e <= s && !eMeri) {
    // "9시부터 6시까지"는 오후를 생략한 것이고, "22시부터 6시까지"는 자정을
    // 넘기는 교대다. 어느 쪽인지는 오후로 밀어 봐야 알 수 있다.
    //
    // 시작이 이미 오후일 때 보정을 아예 끄고 있었다. "오후 1시부터 6시까지"의
    // 시작은 13 으로 보정된 뒤라 s < 12 가 깨지고, 그래서 13:00~06:00 —
    // 17시간 근무가 되어 제53조 판정이 정반대로 선다.
    const pushed = e + 12
    if (pushed > s && pushed <= 24) e = pushed
    // 그래도 뒤집혀 있으면 자정을 넘긴 근무다. 그대로 두면
    // computeWeeklyHours 가 24시간을 더해 제대로 센다.
  }
  if (e === s) return null

  // 사람이 하루에 그만큼 일한다고 합의했을 리 없는 값은 잘못 읽은 것이다.
  // 틀린 근로시간이 근거로 남는 것은 아무것도 남지 않는 것보다 나쁘다.
  const span = e > s ? e - s : 24 - s + e
  if (span > 16) return null

  const pad = (n) => String(n).padStart(2, '0')
  return { start: `${pad(s)}:${sm ?? '00'}`, end: `${pad(e)}:${em ?? '00'}` }
}

// "주 5일", "주5일 근무", "월~금"
//
// 쉬는 날을 안내한 문장이 근무일로 기록됐다. "토~일은 휴무입니다"가 토·일
// 근무로 남으면, 제56조 휴일근로 가산의 전제가 실제 합의와 정반대가 된다.
const DAY_OFF_RE = /휴무|쉽니다|쉬는|제외|off/i

function parseWorkDays(text) {
  const week = text.match(/주\s*([1-7])\s*일/)
  if (week) return `주 ${week[1]}일`
  if (DAY_OFF_RE.test(text)) return null
  const range = text.replace(/요일/g, '').match(/([월화수목금토일])\s*~\s*([월화수목금토일])/)
  if (range) return `${range[1]}~${range[2]}`
  return null
}

// 무엇에 대한 이야기인지 먼저 가린다. 숫자만 보고 값을 뽑으면 "290만원짜리
// 장비를 씁니다" 같은 문장이 임금으로 기록된다.
const FIELD_RULES = [
  {
    field: 'wageBaseAmount',
    label: '임금',
    topic: /임금|급여|월급|연봉|기본급|페이|보수/,
    // 계약서의 wageBaseAmount 는 언제나 '월' 기본급이다. 최저임금 판정은 그
    // 값을 월 소정근로시간으로 나눠 시급을 낸다(contractCheck.js).
    //
    // 그런데 문장에 적힌 금액이 월액인지는 보지 않고 있었다. "연봉 3,600만원"이
    // 월 기본급 36,000,000원으로 기록되어, 최저임금 미달을 따지는 계산이 실제의
    // 12배를 보고 언제나 통과시켰다. 그 값은 나중에 "그때 얼마를 제시했는가"의
    // 근거로도 인용된다.
    read: (t) => {
      const won = parseWon(t)
      if (won === null) return null

      // 시급·일급·주급은 월액으로 옮길 수 없다. 소정근로시간을 알아야 하는데
      // 그것은 이 문장에 없다. 어림으로 환산한 월급이 근거로 남는 것보다
      // 기록하지 않는 편이 낫다.
      if (/시급|시간당|일급|일당|주급/.test(t)) return null

      if (/연봉|연\s*\d|년봉/.test(t)) {
        const monthly = Math.round(won / 12)
        if (monthly < 10000) return null
        return {
          value: monthly,
          // 무엇을 어떻게 옮겼는지 보여 준다. "2,916,667원"만 남으면 나중에
          // 그 숫자가 어디서 왔는지 아무도 되짚지 못한다.
          display: `연봉 ${won.toLocaleString('ko-KR')}원 (월 ${monthly.toLocaleString('ko-KR')}원)`,
        }
      }
      return { value: won, display: `${won.toLocaleString('ko-KR')}원` }
    },
  },
  {
    field: 'contractStartDate',
    label: '근로개시일',
    topic: /출근|입사|개시|시작|첫날|첫 날/,
    read: (t, opts) => {
      const d = parseDate(t, opts)
      return d === null ? null : { value: d, display: d }
    },
  },
  {
    field: 'workHours',
    label: '근무시간',
    // '시 부터'만으로 주제를 잡으면 "점심 휴게시간은 12시부터 13시까지"가
    // 근무시간으로 기록되어, 합의된 09:00~18:00 을 12:00~13:00 으로 갈아치운다.
    // 근무를 말하는 문장인지 먼저 가리고, 휴게·점심 이야기는 뺀다.
    topic: /근무\s*시간|근로\s*시간|소정근로|출퇴근|출근\s*시간|근무는/,
    exclude: /휴게|점심|식사|브레이크|연락처|전화/,
    read: (t) => {
      const h = parseHours(t)
      return h === null ? null : { value: `${h.start}~${h.end}`, display: `${h.start} ~ ${h.end}` }
    },
  },
  {
    field: 'workDays',
    label: '근무일',
    topic: /근무일|근무\s*요일|주\s*[1-7]\s*일|주말|토요일/,
    read: (t) => {
      const d = parseWorkDays(t)
      return d === null ? null : { value: d, display: d }
    },
  },
]

// 값이 어느 문장에 있었는지가 곧 그 값이 무엇에 대한 값인지다.
//
// 메시지 전체를 한 덩어리로 읽고 있었다. 그래서 "면접은 8월 20일입니다.
// 출근일은 추후 안내드립니다"에서 면접 날짜가 근로개시일로 기록됐다 — 주제어와
// 값이 서로 다른 문장에 있었는데도 같은 문장인 것처럼 묶인 것이다. 반대로
// "근무시간은 9시부터 18시까지입니다. 점심 휴게는 12시~13시입니다"는 뒤 문장의
// '휴게' 때문에 앞 문장의 근무시간까지 통째로 버려졌다.
//
// 문장 부호가 없으면 통째로 한 문장이라 예전과 같게 동작한다.
function sentencesOf(body) {
  return String(body ?? '')
    .split(/(?<=[.!?…])\s+|[\n·]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// 메시지 한 건에서 읽어 낸 처우 조건.
//
// 한 문장에 여러 조건이 들어 있으면 모두 뽑는다 — "9시부터 18시까지 주 5일,
// 기본급 290만원입니다"는 세 건이다.
export function extractTermsFromMessage(message, options = {}) {
  const body = String(message?.body ?? '')
  if (!body.trim()) return []

  const sentences = sentencesOf(body)
  const found = []
  for (const rule of FIELD_RULES) {
    for (const sentence of sentences) {
      if (!rule.topic.test(sentence)) continue
      if (rule.exclude && rule.exclude.test(sentence)) continue
      const read = rule.read(sentence, options)
      if (!read) continue
      found.push({
        field: rule.field,
        label: rule.label,
        value: String(read.value),
        display: read.display,
        // 근거로 인용하는 것은 그 값을 말한 문장이다. 메시지 전체를 인용하면
        // 어느 대목이 근거인지 다시 사람이 찾아야 한다.
        excerpt: excerpt(sentence),
      })
      // 한 항목은 한 메시지에서 한 번만 — 뒷문장에서 되풀이해도 진전이 아니다.
      break
    }
  }
  return found
}

// 기록에 새로 남길 것만 고른다.
//
// 같은 값을 여러 번 말하는 것은 협의의 진전이 아니다. 그대로 쌓으면 이력이
// 같은 줄로 가득 차고, 정작 바뀐 지점이 묻힌다. 직전 값과 다를 때만 남긴다.
export function selectNewEntries(extracted, latestByField) {
  const seen = new Map()
  const fresh = []
  for (const e of extracted) {
    const previous = seen.get(e.field) ?? latestByField?.[e.field] ?? null
    if (previous !== null && String(previous) === e.value) continue
    seen.set(e.field, e.value)
    fresh.push({ ...e, previousValue: previous })
  }
  return fresh
}

// 협의 이력을 사람이 읽는 형태로.
export function describeNegotiation(rows) {
  const entries = (rows || []).map((r) => ({
    at: r.created_at ?? r.at,
    field: r.field,
    label: r.label ?? r.field,
    role: r.speaker_role ?? r.role,
    speaker: r.speaker_name ?? null,
    value: r.value_display ?? r.display ?? r.value,
    previousValue: r.previous_display ?? r.previous_value ?? null,
    excerpt: r.excerpt,
  }))

  // 항목별 마지막 값 — "지금까지 합의된 것"으로 읽을 수 있는 최신 상태.
  const latest = {}
  for (const e of entries) latest[e.field] = e

  return {
    entries,
    latest: Object.values(latest),
    // 회사가 제시한 것과 지원자가 제시한 것이 섞여 있다. 누가 말한 값인지
    // 구분하지 않으면 "합의했다"는 주장의 근거가 되지 못한다.
    count: entries.length,
  }
}
