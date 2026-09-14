export const MAX_PASSWORD_LENGTH = 1024

export function isPasswordInput(value, minimum = 1) {
  return typeof value === 'string' && value.length >= minimum && value.length <= MAX_PASSWORD_LENGTH
}

export function isAccountEmail(value) {
  if (typeof value !== 'string') return false
  const email = value.trim()
  if (email.length > 254) return false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 32 || code === 127) return false
  }
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
}

// Shared by public signup and administrator-created accounts. Validate before
// hashing a password or passing values to the database; never coerce JSON objects.
export function validateAccountProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '잘못된 요청입니다.'
  if (!isAccountEmail(body.email)) return '올바른 이메일 주소를 입력해주세요.'
  if (typeof body.displayName !== 'string' || !body.displayName.trim() || body.displayName.trim().length > 100) {
    return '이름은 1~100자로 입력해주세요.'
  }
  if (body.companyName != null && (typeof body.companyName !== 'string' || body.companyName.trim().length > 200)) {
    return '회사명은 200자 이하의 글자로 입력해주세요.'
  }
  if (!['company', 'candidate'].includes(body.role)) return '역할이 올바르지 않습니다.'
  if (body.remember !== undefined && typeof body.remember !== 'boolean') return '로그인 유지 설정이 올바르지 않습니다.'
  if (body.isRecruiter !== undefined && typeof body.isRecruiter !== 'boolean') return '채용 담당자 설정이 올바르지 않습니다.'
  return null
}
