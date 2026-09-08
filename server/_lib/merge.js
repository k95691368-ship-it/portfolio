// Returns newVal unless it is null/undefined, in which case it falls back to
// oldVal (or null). This is what lets a re-analysis keep previously-confirmed
// values instead of wiping them when the model returns null for an unmentioned
// field.
export function mergeValue(newVal, oldVal) {
  return newVal === null || newVal === undefined ? (oldVal ?? null) : newVal
}

// Merges the four social-insurance booleans field-by-field, preserving any
// previously-confirmed true/false when the new analysis leaves that field null.
// Returns { merged, json } where json is null when every field ended up
// null/undefined (so we don't persist an all-null object).
export function mergeSocialInsurance(newSI, oldJson) {
  // 저장된 값이 깨져 있으면 이번 분석이 통째로 실패한다. 읽지 못한 이전 값은
  // 없는 것으로 보고, 새로 확인된 값만으로 이어 간다.
  let old = {}
  if (oldJson) {
    try {
      const parsed = JSON.parse(oldJson)
      if (parsed && typeof parsed === 'object') old = parsed
    } catch {
      old = {}
    }
  }
  const n = newSI || {}
  const merged = {
    employment_insurance: mergeValue(n.employment_insurance, old.employment_insurance),
    health_insurance: mergeValue(n.health_insurance, old.health_insurance),
    national_pension: mergeValue(n.national_pension, old.national_pension),
    industrial_accident_insurance: mergeValue(
      n.industrial_accident_insurance,
      old.industrial_accident_insurance
    ),
  }
  const hasAny = Object.values(merged).some((v) => v !== null && v !== undefined)
  return { merged, json: hasAny ? JSON.stringify(merged) : null }
}
