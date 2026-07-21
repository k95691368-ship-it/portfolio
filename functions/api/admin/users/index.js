import { jsonResponse } from '../../../_lib/http.js'

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, email, display_name, company_name, role, is_admin, is_suspended, created_at
     FROM users ORDER BY created_at DESC`
  ).all()

  return jsonResponse({
    users: results.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      companyName: u.company_name,
      role: u.role,
      isAdmin: !!u.is_admin,
      isSuspended: !!u.is_suspended,
      createdAt: u.created_at,
    })),
  })
}
