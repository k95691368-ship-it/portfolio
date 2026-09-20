// JSON values must not become "[object Object]", and null must not crash PATCH.
// Missing/null optional fields still mean empty, as in the existing editor.
export function postingInputError(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '잘못된 요청입니다.'
  for (const field of ['title', 'description', 'department', 'employmentType', 'location', 'deadline', 'wageType', 'workHoursStart', 'workHoursEnd', 'workDays']) {
    if (body[field] != null && typeof body[field] !== 'string') return '공고의 텍스트 항목은 문자열로 입력해주세요.'
  }
  for (const field of ['wageMin', 'wageMax']) {
    const value = body[field]
    if (value != null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
      return '임금 항목은 숫자 또는 문자열로 입력해주세요.'
    }
  }
  return null
}
