// Record attempted uploads before sending bytes. A crash or a failed deletion
// leaves a durable job; referenced documents are never removed by cleanup.
export async function stageApplicationUpload(env, key) {
  await env.DB.prepare('INSERT INTO application_upload_staging (storage_key) VALUES (?)').bind(key).run()
}

export async function settleApplicationUpload(env, key) {
  const referenced = await env.DB.prepare('SELECT id FROM application_documents WHERE r2_key = ?').bind(key).first()
  if (!referenced) await env.DOCUMENTS.delete(key)
  await env.DB.prepare('DELETE FROM application_upload_staging WHERE storage_key = ?').bind(key).run()
}

export async function cleanStagedApplicationUploads(env, { dryRun = true, limit = 25 } = {}) {
  const { results } = await env.DB.prepare(`SELECT storage_key FROM application_upload_staging
    WHERE created_at < datetime('now', '-1 day') ORDER BY created_at LIMIT ?`)
    .bind(Math.max(1, Math.min(25, Number(limit) || 25))).all()
  if (dryRun) return { pending: results.length, cleaned: 0, failed: 0 }
  const result = { pending: results.length, cleaned: 0, failed: 0 }
  for (const row of results) {
    try { await settleApplicationUpload(env, row.storage_key); result.cleaned += 1 }
    catch { result.failed += 1 }
  }
  return result
}
