import { jsonResponse } from '../_lib/http.js'

export async function onRequestGet({ data }) {
  if (!data.user) return jsonResponse({ user: null })

  const { id, email, role, display_name, company_name, is_admin, is_recruiter, is_developer, must_change_password } = data.user
  return jsonResponse({
    user: {
      id,
      email,
      role,
      displayName: display_name,
      companyName: company_name,
      isAdmin: !!is_admin,
      isRecruiter: !!is_recruiter,
      isDeveloper: !!is_developer,
      mustChangePassword: !!must_change_password,
    },
  })
}
