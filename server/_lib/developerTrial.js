export const TRIAL_SECONDS = 60 * 60
export const TRIAL_AUTH_METHOD = 'developer_trial'
export const OWNER_EMAIL = 'k95691368@gmail.com'

export function isProtectedDeveloper(user) {
  return !!user?.is_developer || String(user?.email || '').trim().toLowerCase() === OWNER_EMAIL
}

// Privileges exist only on a live trial session, never on the persisted account.
export function applyTrialCapabilities(user) {
  if (!user || user.session_auth_method !== TRIAL_AUTH_METHOD) return user
  const utcStamp = (value) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
    ? value.replace(' ', 'T') + 'Z' : value
  const expires = Date.parse(utcStamp(user.session_expires_at))
  const started = Date.parse(utcStamp(user.session_started_at))
  if (isProtectedDeveloper(user) || !String(user.email).endsWith('@trial.invalid') ||
      !Number.isFinite(expires) || !Number.isFinite(started) || expires <= Date.now() ||
      started > Date.now() + 1000 || expires <= started ||
      expires - started > (TRIAL_SECONDS + 1) * 1000) return null
  return { ...user, is_admin: 1, is_recruiter: 1, is_developer: 1, developer_trial: true }
}

export function trialProfile(user) {
  return {
    id: user.id, email: user.email, role: 'company', displayName: user.display_name,
    isAdmin: true, isRecruiter: true, isDeveloper: true, developerTrial: true,
    trialExpiresAt: user.session_expires_at, mustChangePassword: false,
  }
}
