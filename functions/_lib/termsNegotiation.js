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
  const t = String(text ?? '').replace(/(\d),(?=\d{3}(?!\d))/g, '$1')

  // 천만은 천×만이므로 따로 잡지 않으면 "3천"과 "만"으로 쪼개진다.
  const units = [...t.matchAll(/(\d+)\s*(억|천만|만|천)/g)]
  if (units.length > 0) {
    let total = 0
    for (const m of units) {
      const n = Number(m[1])
      const scale = SCALE[m[2]]
      if (Number.isFinite(n) && scale) total += n * scale
    }
    // 만 단위에 못 미치는 값은 임금으로 보지 않는다. "3천 원"은 금액이지
    // 급여가 아니다.
    if (total >= 10000) return total
  }

  const plain = t.match(/(\d{6,12})\s*원/)
  if (plain) {
    const n = Number(plain[1])
    if (Number.isFinite(n) && n >= 100000) return n
  }
  return null
}

// "9월 1일", "2026-09-01", "2026년 9월 1일"
function parseDate(text, { year = new Date().getUTCFullYear() } = {}) {
  const iso = text.match(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/)
  if (iso) {
    const [, y, m, d] = iso
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  const md = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (md) {
    const [, m, d] = md
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}

// "09시부터 18시까지", "9시~18시", "09:00 ~ 18:00"
function parseHours(text) {
  const m = text.match(
    /(\d{1,2})\s*(?::(\d{2}))?\s*시?\s*(?:부터|~|-|에서)\s*(\d{1,2})\s*(?::(\d{2}))?\s*시?\s*(?:까지)?/
  )
  if (!m) return null
  const [, sh, sm, eh, em] = m
  const s = Number(sh)
  const e = Number(eh)
  if (!Number.isFinite(s) || !Number.isFinite(e) || s > 24 || e > 24) return null
  const pad = (n) => String(n).padStart(2, '0')
  return { start: `${pad(s)}:${sm ?? '00'}`, end: `${pad(e)}:${em ?? '00'}` }
}

// "주 5일", "주5일 근무", "월~금"
function parseWorkDays(text) {
  const week = text.match(/주\s*([1-7])\s*일/)
  if (week) return `주 ${week[1]}일`
  const range = text.replace(/요일/g, '').match(/([월화수목금토일])\s*[~-]\s*([월화수목금토일])/)
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
    read: (t) => {
      const won = parseWon(t)
      return won === null ? null : { value: won, display: `${won.toLocaleString('ko-KR')}원` }
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
    topic: /근무\s*시간|근로\s*시간|출퇴근|시\s*부터|출근\s*시간/,
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

// 메시지 한 건에서 읽어 낸 처우 조건.
//
// 한 문장에 여러 조건이 들어 있으면 모두 뽑는다 — "9시부터 18시까지 주 5일,
// 기본급 290만원입니다"는 세 건이다.
export function extractTermsFromMessage(message, options = {}) {
  const body = String(message?.body ?? '')
  if (!body.trim()) return []

  const found = []
  for (const rule of FIELD_RULES) {
    if (!rule.topic.test(body)) continue
    const read = rule.read(body, options)
    if (!read) continue
    found.push({
      field: rule.field,
      label: rule.label,
      value: String(read.value),
      display: read.display,
      excerpt: excerpt(body),
    })
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
