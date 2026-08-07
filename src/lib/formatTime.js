// 서버가 남긴 UTC 시각을 한국 시각으로 보여 준다 (순수 함수 — 단위 테스트 대상).
//
// D1 의 datetime('now') 는 "2026-08-07 16:00:00" 같은 UTC 문자열을 남긴다.
// 화면에서는 그것을 slice(0, 16) 으로 잘라 그대로 보여 주고 있었다. 시간대
// 표시가 없으니 사용자는 그것을 한국 시각으로 읽는다.
//
// 그래서 한국시간 8월 8일 새벽 1시에 한 서명이 계약서에 "2026-08-07 16:00"으로
// 적혔다. 아홉 시간이 어긋나고, 새벽에 한 일은 날짜까지 하루 전으로 보인다.
// 서명 시각은 "언제 동의했는가"를 다투는 자리에서 근거가 되는 값이라, 표시가
// 틀리면 기록이 틀린 것과 같아진다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

// SQLite "2026-08-07 16:00:00" 과 ISO "2026-08-07T16:00:00Z" 를 모두 받는다.
// 둘 다 UTC로 저장된 값이다.
function parseUtc(value) {
  if (!value) return null
  const text = String(value).trim()
  const normalized = text.includes('T') ? text : text.replace(' ', 'T')
  const withZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`
  const d = new Date(withZone)
  return Number.isNaN(d.getTime()) ? null : d
}

function pad(n) {
  return String(n).padStart(2, '0')
}

// "2026-08-08 01:00" (한국 시각)
export function formatKst(value) {
  const d = parseUtc(value)
  if (!d) return ''
  const k = new Date(d.getTime() + KST_OFFSET_MS)
  return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`
}

// "2026-08-08" (한국 날짜)
export function formatKstDate(value) {
  const d = parseUtc(value)
  if (!d) return ''
  const k = new Date(d.getTime() + KST_OFFSET_MS)
  return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`
}
