// 한 공고의 지원자를 한눈에 비교하기 위한 정렬 (순수 함수 — 단위 테스트 대상).
//
// 지원자가 서른 명이면 채용자는 서른 번을 눌러 들어가 하나씩 읽어야 했다.
// 여기서 한 화면에 늘어놓고 같은 기준으로 견준다.
//
// 순서를 매기는 것은 AI가 아니다. AI에게 "누가 더 나은 사람인가"를 묻는 대신,
// 이미 각 지원서마다 개별적으로 나온 직무 적합도(AI 심사)와 경력 기간이라는
// 두 가지 사실만으로 결정론적으로 정렬한다. 같은 입력이면 항상 같은 순서가
// 나오고, 각 지원자가 왜 그 자리에 있는지 근거를 함께 돌려준다.
//
// 나이·성별·출신지역 같은 직무와 무관한 정보는 정렬에 쓰지 않는다.

export const FIT_SCORE = { high: 3, medium: 2, low: 1, unknown: 0 }
export const FIT_LABEL = { high: '적합', medium: '보통', low: '낮음', unknown: '판단 보류' }
const STATUS_ORDER = { passed: 0, submitted: 1, rejected: 2 }

function parseDate(value) {
  const m = String(value ?? '').match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  if (!Number.isFinite(y) || mo < 1 || mo > 12) return null
  return { y, mo }
}

// 경력 항목들의 재직 개월 수 합계. 겹치는 기간은 각각 세지 않고 합친다.
export function careerMonths(entries, now = new Date()) {
  if (!Array.isArray(entries) || entries.length === 0) return 0

  const nowIndex = now.getUTCFullYear() * 12 + now.getUTCMonth()
  const spans = []

  for (const e of entries) {
    const start = parseDate(e?.startDate)
    if (!start) continue
    const startIndex = start.y * 12 + (start.mo - 1)

    let endIndex
    if (e?.current) {
      endIndex = nowIndex
    } else {
      const end = parseDate(e?.endDate)
      if (!end) continue
      endIndex = end.y * 12 + (end.mo - 1)
    }
    if (endIndex < startIndex) continue
    // 시작월과 종료월을 모두 재직한 것으로 본다.
    spans.push([startIndex, endIndex + 1])
  }

  if (spans.length === 0) return 0

  // 두 회사를 겹쳐 다닌 기간을 두 번 세면 실제보다 길어진다.
  spans.sort((a, b) => a[0] - b[0])
  let total = 0
  let [curStart, curEnd] = spans[0]
  for (let i = 1; i < spans.length; i += 1) {
    const [s, e] = spans[i]
    if (s <= curEnd) {
      curEnd = Math.max(curEnd, e)
    } else {
      total += curEnd - curStart
      curStart = s
      curEnd = e
    }
  }
  total += curEnd - curStart
  return total
}

export function formatCareer(months) {
  if (!months) return '경력 정보 없음'
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m}개월`
  if (m === 0) return `${y}년`
  return `${y}년 ${m}개월`
}

// 지원자 한 명의 비교용 요약.
// row: applications 행 + 파싱된 career/screening
export function toComparable(row, now = new Date()) {
  const screening = row.screening || null
  const fit = screening?.fit && FIT_SCORE[screening.fit] !== undefined ? screening.fit : 'unknown'
  const months = careerMonths(row.career, now)

  return {
    id: row.id,
    applicantName: row.applicantName,
    status: row.status,
    createdAt: row.createdAt,
    screened: !!screening,
    fit,
    fitLabel: FIT_LABEL[fit],
    fitReason: screening?.fitReason ?? null,
    strengths: screening?.strengths ?? [],
    concerns: screening?.concerns ?? [],
    careerMonths: months,
    careerLabel: formatCareer(months),
    companies: (Array.isArray(row.career) ? row.career : [])
      .map((c) => c?.companyName)
      .filter(Boolean)
      .slice(0, 5),
  }
}

// 왜 이 자리에 있는지 한 줄로 설명한다. 근거 없는 순위는 신뢰할 수 없다.
function basisOf(item) {
  const parts = []
  parts.push(item.screened ? `직무 적합도 ${item.fitLabel}` : 'AI 심사 전')
  if (item.careerMonths > 0) parts.push(`경력 ${item.careerLabel}`)
  return parts.join(' · ')
}

// 정렬 기준: 심사 결과(적합도) → 경력 기간 → 먼저 지원한 순.
// 불합격 처리된 지원서는 비교 대상이지만 뒤로 보낸다.
export function rankApplicants(rows, now = new Date()) {
  const items = (rows || []).map((r) => toComparable(r, now))

  items.sort((a, b) => {
    const statusDiff = (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1)
    if (statusDiff !== 0) return statusDiff
    const fitDiff = FIT_SCORE[b.fit] - FIT_SCORE[a.fit]
    if (fitDiff !== 0) return fitDiff
    if (b.careerMonths !== a.careerMonths) return b.careerMonths - a.careerMonths
    return String(a.createdAt).localeCompare(String(b.createdAt))
  })

  // 기준이 완전히 같으면 같은 순위를 준다. 우열이 없는데 번호로 갈라놓으면
  // 없는 차이를 있는 것처럼 보이게 한다.
  let lastKey = null
  let lastRank = 0
  return items.map((item, i) => {
    const key = `${item.status}|${item.fit}|${item.careerMonths}`
    const rank = key === lastKey ? lastRank : i + 1
    lastKey = key
    lastRank = rank
    return { ...item, rank, basis: basisOf(item) }
  })
}

// 비교 화면 상단에 보여줄 요약.
export function summarizeRanking(ranked) {
  const counts = { high: 0, medium: 0, low: 0, unknown: 0 }
  let unscreened = 0
  for (const item of ranked) {
    counts[item.fit] += 1
    if (!item.screened) unscreened += 1
  }
  return {
    total: ranked.length,
    byFit: counts,
    unscreened,
    passed: ranked.filter((i) => i.status === 'passed').length,
    rejected: ranked.filter((i) => i.status === 'rejected').length,
  }
}
