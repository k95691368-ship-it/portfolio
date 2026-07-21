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
  const old = oldJson ? JSON.parse(oldJson) : {}
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
