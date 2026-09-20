// The account-recovery endpoint returns the account directly, not { user }.
// Check the completion contract before consuming proof or publishing a session.
export function isVerifiedAccount(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (typeof value.id !== 'string' || !value.id || value.id.length > 100 || /\s/.test(value.id)) return false
  if (typeof value.email !== 'string' || value.email.length > 254) return false
  if ([...value.email].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return false
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.email)) return false
  if (!['company', 'candidate'].includes(value.role)) return false
  if (typeof value.displayName !== 'string' || !value.displayName.trim() || value.displayName.trim().length > 100) return false
  return value.emailVerified === true
    && ['mustChangePassword', 'isAdmin', 'isRecruiter', 'isDeveloper'].every((key) => typeof value[key] === 'boolean')
}

export function assertVerifiedAccount(value) {
  if (!isVerifiedAccount(value)) {
    const error = new Error('이메일 확인 결과를 확인하지 못했습니다. 로그인 상태를 확인하거나 새 인증 메일을 요청해주세요.')
    error.code = 'INVALID_VERIFIED_ACCOUNT'
    throw error
  }
  return value
}
