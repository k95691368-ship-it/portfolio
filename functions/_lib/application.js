// 공개 지원서 입력 검증/정규화 (순수 함수, 단위 테스트 대상).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseBool(v) {
  return v === true || v === 'true' || v === '1' || v === 'on'
}

export function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim())
}

// 지원자 기본 정보 + 필수 동의 검증. 유효하면 null, 아니면 오류 메시지.
export function validateApplication({ name, email, phone, consentRequired }) {
  if (!name || !String(name).trim()) return '이름을 입력해주세요.'
  if (!isValidEmail(email)) return '올바른 이메일 주소를 입력해주세요.'
  if (!phone || !String(phone).trim()) return '연락처를 입력해주세요.'
  if (!consentRequired) return '개인정보 필수항목 수집·이용에 동의해야 지원할 수 있습니다.'
  return null
}

const CAREER_STRING_FIELDS = [
  'employmentType',
  'companyName',
  'startDate',
  'endDate',
  'department',
  'position',
  'description',
]
const CAREER_FIELD_MAX = 500
const MAX_CAREER_ENTRIES = 20

// 경력사항 배열(JSON 문자열 또는 배열)을 검증·정규화.
// 반환: { ok: true, value: 정규화된 JSON 문자열 | null } 또는 { ok: false, error }
export function normalizeCareer(raw) {
  if (raw == null || raw === '') return { ok: true, value: null }

  let parsed
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return { ok: false, error: '경력사항 형식이 올바르지 않습니다.' }
  }
  if (!Array.isArray(parsed)) return { ok: false, error: '경력사항 형식이 올바르지 않습니다.' }
  if (parsed.length === 0) return { ok: true, value: null }
  if (parsed.length > MAX_CAREER_ENTRIES) {
    return { ok: false, error: `경력은 최대 ${MAX_CAREER_ENTRIES}개까지 입력할 수 있습니다.` }
  }

  const cleaned = parsed.map((entry) => {
    const e = entry && typeof entry === 'object' ? entry : {}
    const out = { current: !!e.current }
    for (const field of CAREER_STRING_FIELDS) {
      const val = e[field]
      out[field] = typeof val === 'string' ? val.slice(0, CAREER_FIELD_MAX) : ''
    }
    return out
  })

  return { ok: true, value: JSON.stringify(cleaned) }
}
