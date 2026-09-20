import { jsonError } from './http.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Throwing the response also rolls back any writes made before an unsuccessful
// handler response; a failed operation must never leave a durable claim behind.
class FailedCreateResponse extends Error {
  constructor(response) {
    super('create_operation_failed')
    this.response = response
  }
}

// Callers supply only normalized, fixed-order payload fields, never the session
// or operation ID. The ledger stores a digest, not a second copy of the form.
async function fingerprint(payload) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function runCreateOperation({ env, userId, kind, operationId, payload, create, recover }) {
  // Keep older clients compatible. New clients always send an explicit UUID.
  if (operationId === undefined) return create(env)
  if (typeof operationId !== 'string' || !UUID.test(operationId)) {
    return jsonError('생성 요청 식별자가 올바르지 않습니다.', 400)
  }
  if (typeof env.DB.withRateLimitLock !== 'function') {
    return jsonError('안전한 생성 요청 처리를 사용할 수 없습니다. 같은 요청으로 다시 시도해주세요.', 503)
  }

  const key = operationId.toLowerCase()
  const payloadHash = await fingerprint(payload)
  try {
    // The PostgreSQL adapter holds an advisory transaction lock, not an
    // in-process mutex. Creation and the durable receipt commit together.
    return await env.DB.withRateLimitLock(`create:${kind}:${userId}:${key}`, async db => {
      const scopedEnv = { ...env, DB: db }
      const existing = await db.prepare(`SELECT payload_hash, resource_id FROM create_operations
        WHERE owner_user_id = ? AND kind = ? AND operation_id = ?`)
        .bind(userId, kind, key).first()
      if (existing) {
        if (existing.payload_hash !== payloadHash) {
          return jsonError('같은 요청 식별자로 다른 내용을 등록할 수 없습니다. 기존 요청 결과를 먼저 확인해주세요.', 409)
        }
        return recover(scopedEnv, existing.resource_id)
      }

      const response = await create(scopedEnv)
      if (!response.ok) throw new FailedCreateResponse(response)
      const result = await response.clone().json()
      if (typeof result.id !== 'string' || !result.id) throw new Error('create_operation_missing_resource')
      await db.prepare(`INSERT INTO create_operations
        (owner_user_id, kind, operation_id, payload_hash, resource_id) VALUES (?, ?, ?, ?, ?)`)
        .bind(userId, kind, key, payloadHash, result.id).run()
      return response
    })
  } catch (error) {
    if (error instanceof FailedCreateResponse) return error.response
    console.error('Create operation transaction failed', { kind, code: error?.code || 'unknown' })
    return jsonError('생성 요청 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도해주세요.', 503)
  }
}
