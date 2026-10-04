import { jsonResponse, jsonError } from './http.js'
import { boundedRequest, RequestBodyError } from './requestBody.js'
import { processStorageCleanup } from './storageCleanup.js'

// This credential authorizes only existing cleanup receipts. It is neither an
// application session nor permission to run the broader retention job.
export async function handleStorageCleanupJob(request, env) {
  const secret = env.STORAGE_CLEANUP_JOB_SECRET
  if (typeof secret !== 'string' || !secret || secret !== secret.trim()
    || request.headers.get('Authorization') !== `Bearer ${secret}`) {
    return jsonError('Storage cleanup authorization required.', 403)
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'POST is required.' }, 405, { Allow: 'POST' })
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return jsonError('JSON is required.', 415)
  }

  let body
  try {
    body = await (await boundedRequest(request)).json()
  } catch (error) {
    return jsonError('Invalid storage cleanup request.', error instanceof RequestBodyError ? error.status : 400)
  }
  if (!body || Array.isArray(body) || typeof body !== 'object'
    || Object.keys(body).length !== 1 || typeof body.dryRun !== 'boolean') {
    return jsonError('dryRun must be the only field and must be boolean.', 400)
  }

  const dryRun = body.dryRun || env.STORAGE_CLEANUP_EXECUTE !== '1'
  try {
    const report = await processStorageCleanup(env, { dryRun, limit: 25 })
    return jsonResponse({ dryRun, ...report })
  } catch {
    // Provider/database errors can contain private paths and credentials.
    return jsonError('Storage cleanup job could not be completed.', 503)
  }
}
