// 감사 로그의 '세부정보'를 사람이 읽는 말로 (순수 함수 — 단위 테스트 대상).
//
// 서버가 남긴 그대로 `title=테스트 1` 이라고 찍고 있었다. 이 표는 나중에
// "언제 누가 무엇을 했는가"를 따질 때 근거로 읽히는 자리인데, 코드 안에서
// 쓰는 이름이 그대로 나오면 그 자리에서 무엇이 지워졌는지 읽어 내지 못한다.
//
// 이미 쌓인 기록도 함께 읽혀야 한다. 서버 쪽 문구만 바꾸면 지난 기록은
// 영영 영어 키로 남는다. 그래서 표시하는 쪽에서 옮긴다.

const KEY_LABELS = {
  title: '면접방 이름',
  email: '이메일',
  role: '역할',
  isRecruiter: '채용자 권한',
  발급번호: '발급번호',
}

const VALUE_LABELS = {
  role: { company: '회사', candidate: '구직자' },
  isRecruiter: { true: '있음', false: '없음' },
}

function describePart(part) {
  const text = part.trim()
  if (!text) return null

  const eq = text.indexOf('=')
  if (eq <= 0) return text

  const key = text.slice(0, eq).trim()
  const raw = text.slice(eq + 1).trim()
  const label = KEY_LABELS[key]
  if (!label) return text

  const value = VALUE_LABELS[key]?.[raw] ?? raw
  return `${label}: ${value}`
}

export function describeAuditDetail(detail) {
  if (!detail) return '-'
  return String(detail)
    .split(',')
    .map(describePart)
    .filter(Boolean)
    .join(' · ')
}
