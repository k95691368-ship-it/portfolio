import { canManageRecruiting } from './recruiter.js'
import { jsonError } from './http.js'

export const DRAFT_FIELDS = {
  title: 150, department: 100, employmentType: 100, location: 100,
  deadline: 10, description: 20000, wageType: 20, wageMin: 100, wageMax: 100,
  workHoursStart: 100, workHoursEnd: 100, workDays: 100,
}
export function draftAccess(user) {
  if (!user) return jsonError('로그인이 필요합니다.', 401)
  if (!canManageRecruiting(user)) return jsonError('채용 관리 권한이 없습니다.', 403)
  return null
}
export function validDraftId(id) {
  return typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
}
export function draftFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const fields = {}
  for (const [key, max] of Object.entries(DRAFT_FIELDS)) {
    const value = input[key] ?? ''
    if (typeof value !== 'string' || value.length > max) return null
    fields[key] = value
  }
  return fields
}
