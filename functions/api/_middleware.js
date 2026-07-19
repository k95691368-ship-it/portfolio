import { getSessionUser } from '../_lib/auth.js'

export async function onRequest(context) {
  context.data.user = await getSessionUser(context.env.DB, context.request)
  return context.next()
}
