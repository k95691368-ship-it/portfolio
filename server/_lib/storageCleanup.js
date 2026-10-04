// Callers pass only fixed internal SELECT statements. Queue parent-removal keys
// in its transaction; defer upload candidates before storage can accept bytes.
export function storageCleanupIntent(db, bucket, operationId, source, values = [], { defer = false } = {}) {
  // Supabase upload tokens last 2h; a TUS URL created during that window can
  // last another 24h. Wait 48h after removal so an already issued capability
  // cannot recreate a recording after its cleanup receipt has been discarded.
  // Deferred document candidates use the same grace period for in-flight saves.
  // https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl
  // https://supabase.com/docs/guides/storage/uploads/resumable-uploads
  return db.prepare(`INSERT INTO storage_cleanup_intents (bucket, storage_key, operation_id, not_before)
    SELECT ?, target.storage_key, ?, CASE WHEN ? = 'interview-recordings' OR ? = 1
      THEN datetime('now', '+2 days') ELSE datetime('now') END
    FROM (${source}) target WHERE target.storage_key IS NOT NULL
    ON CONFLICT(bucket, storage_key) DO UPDATE SET operation_id = excluded.operation_id,
      not_before = excluded.not_before, next_attempt_at = datetime('now')`).bind(bucket, operationId, bucket, defer ? 1 : 0, ...values)
}

async function isReferenced(db, { bucket, storage_key: key }) {
  if (bucket === 'documents') {
    return !!await db.prepare(`SELECT 1 AS present WHERE
      EXISTS (SELECT 1 FROM documents WHERE r2_key = ?)
      OR EXISTS (SELECT 1 FROM application_documents WHERE r2_key = ?)
      OR EXISTS (SELECT 1 FROM signed_contracts WHERE r2_key = ?)
      OR EXISTS (SELECT 1 FROM contract_archive WHERE document_key = ?)`)
      .bind(key, key, key, key).first()
  }
  if (bucket === 'interview-recordings') {
    return !!await db.prepare('SELECT 1 AS present FROM interview_recordings WHERE r2_key = ? LIMIT 1').bind(key).first()
  }
  throw new Error('Unsupported cleanup bucket')
}

// Uploads use fresh immutable object keys. Repeated/concurrent provider DELETEs
// are safe (including 404); a receipt is removed only after provider success.
// Retaining live references also protects permanent archives and shared files.
export async function processStorageCleanup(env, { dryRun = true, limit = 25, operationId } = {}) {
  const batchSize = Math.max(1, Math.min(25, Math.trunc(Number(limit) || 25)))
  const query = `SELECT bucket, storage_key, operation_id FROM storage_cleanup_intents
    WHERE not_before <= datetime('now') AND next_attempt_at <= datetime('now')${operationId ? ' AND operation_id = ?' : ''}
    ORDER BY next_attempt_at, bucket, storage_key LIMIT ?`
  const { results } = await env.DB.prepare(query).bind(...(operationId ? [operationId] : []), batchSize).all()
  const report = { pending: results.length, deleted: 0, failed: 0, protected: 0 }
  if (dryRun) return report
  for (const target of results) {
    try {
      // Delay failures/protected keys so one bad object cannot starve the queue.
      const attempt = await env.DB.prepare(`UPDATE storage_cleanup_intents SET attempts = attempts + 1,
        next_attempt_at = datetime('now', '+5 minutes')
        WHERE bucket = ? AND storage_key = ? AND operation_id = ? AND not_before <= datetime('now') AND next_attempt_at <= datetime('now')`)
        .bind(target.bucket, target.storage_key, target.operation_id).run()
      if (!attempt.meta?.changes) continue
      if (await isReferenced(env.DB, target)) { report.protected++; continue }
      const storage = target.bucket === 'documents' ? env.DOCUMENTS : env.INTERVIEW_RECORDINGS
      if (!storage) throw new Error('Cleanup storage unavailable')
      await storage.delete(target.storage_key)
      await env.DB.prepare('DELETE FROM storage_cleanup_intents WHERE bucket = ? AND storage_key = ? AND operation_id = ?')
        .bind(target.bucket, target.storage_key, target.operation_id).run()
      report.deleted++
    } catch {
      // An ambiguous provider/DB acknowledgement keeps the exact durable key.
      report.failed++
    }
  }
  return report
}

// Parent rows are already removed. A cleanup outage must not misreport that
// committed deletion as a rollback or claim that all bytes were removed.
export async function finishStorageCleanup(env, operationId) {
  try {
    await processStorageCleanup(env, { dryRun: false, operationId })
    const pending = await env.DB.prepare('SELECT 1 AS pending FROM storage_cleanup_intents WHERE operation_id = ? LIMIT 1')
      .bind(operationId).first()
    return { cleanupPending: !!pending }
  } catch {
    return { cleanupPending: true }
  }
}
