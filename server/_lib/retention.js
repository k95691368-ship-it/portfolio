import { cleanStagedApplicationUploads } from './applicationUploadCleanup.js'

// Ephemeral proof records contain email addresses and password snapshots. Keep
// their cleanup bounded and part of the existing retention job, not permanent.
export async function cleanExpiredRecoveryData(env, { dryRun = true, limit = 25 } = {}) {
  const batchSize = Math.max(1, Math.min(25, Number(limit) || 25))
  const definitions = [
    ['application_access_tokens', "datetime(expires_at) <= datetime('now') OR (used_at IS NOT NULL AND used_at <= datetime('now', '-5 minutes'))"],
    ['application_access_sessions', "datetime(expires_at) <= datetime('now')"],
    ['account_recovery_tokens', "datetime(expires_at) <= datetime('now') OR (consumed_at IS NOT NULL AND consumed_at <= datetime('now', '-5 minutes'))"],
  ]
  const report = { pending: 0, deleted: 0 }
  for (const [table, condition] of definitions) {
    const { results } = await env.DB.prepare(`SELECT token_hash FROM ${table} WHERE ${condition} ORDER BY expires_at LIMIT ?`).bind(batchSize).all()
    report.pending += results.length
    if (!dryRun && results.length) {
      const deleted = await env.DB.batch(results.map(row => env.DB.prepare(`DELETE FROM ${table} WHERE token_hash = ? AND (${condition})`).bind(row.token_hash)))
      report.deleted += deleted.reduce((count, row) => count + (row.meta?.changes || 0), 0)
    }
  }
  return report
}

// Bounded, restartable deletion. Storage keys remain in the database until
// deletion succeeds; no expired object is represented as physically deleted.
export async function runRetention(env, { dryRun = true, limit = 25 } = {}) {
  const batchSize = Math.max(1, Math.min(25, Number(limit) || 25))
  const uploadCleanup = await cleanStagedApplicationUploads(env, { dryRun, limit: batchSize })
  const recoveryCleanup = await cleanExpiredRecoveryData(env, { dryRun, limit: batchSize })
  const { results: recordings } = await env.DB.prepare(`SELECT id, r2_key FROM interview_recordings
    WHERE retention_until IS NOT NULL AND datetime(retention_until) <= datetime('now')
      AND deleted_at IS NULL AND retention_hold_reason IS NULL
      AND status NOT IN ('starting','recording','paused','stopping')
    ORDER BY retention_until LIMIT ?`).bind(batchSize).all()
  const { results: applications } = await env.DB.prepare(`SELECT id FROM applications
    WHERE datetime(created_at) <= datetime('now', '-3 years') AND purged_at IS NULL
      AND retention_hold_reason IS NULL ORDER BY created_at LIMIT ?`).bind(batchSize).all()
  const candidates = [...(recordings || []).map((r) => ({ ...r, kind: 'recording' })), ...(applications || []).map((r) => ({ ...r, kind: 'application' }))]
  if (dryRun) return { dryRun: true, recordings: recordings?.length || 0, applications: applications?.length || 0, uploadCleanup, recoveryCleanup }
  const report = { dryRun: false, deleted: 0, failed: 0, skipped: 0, uploadCleanup, recoveryCleanup }
  for (const target of candidates) {
    const key = `${target.kind}:${target.id}`
    const token = crypto.randomUUID()
    const claim = await env.DB.prepare(`INSERT INTO retention_jobs (id, lock_token, status, attempts)
      VALUES (?, ?, 'running', 1) ON CONFLICT(id) DO UPDATE SET lock_token = excluded.lock_token,
        status = 'running', attempts = retention_jobs.attempts + 1, updated_at = datetime('now')
      WHERE retention_jobs.status = 'failed' AND datetime(retention_jobs.updated_at) < datetime('now', '-5 minutes')
         OR retention_jobs.status = 'running' AND datetime(retention_jobs.updated_at) < datetime('now', '-10 minutes')`)
      .bind(key, token).run()
    if (!claim.meta?.changes) { report.skipped++; continue }
    try {
      if (target.kind === 'recording') {
        const current = await env.DB.prepare('SELECT r2_key, retention_hold_reason FROM interview_recordings WHERE id = ?').bind(target.id).first()
        if (!current || current.retention_hold_reason) throw new Error('held')
        if (current.r2_key) await env.INTERVIEW_RECORDINGS.delete(current.r2_key)
        await env.DB.prepare(`UPDATE interview_recordings SET status = 'deleted', storage_status = 'deleted',
          r2_key = NULL, provider_download_url = NULL, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
          .bind(target.id).run()
      } else {
        const current = await env.DB.prepare('SELECT retention_hold_reason FROM applications WHERE id = ?').bind(target.id).first()
        if (!current || current.retention_hold_reason) throw new Error('held')
        const { results: files } = await env.DB.prepare('SELECT r2_key FROM application_documents WHERE application_id = ?').bind(target.id).all()
        for (const file of files || []) await env.DOCUMENTS.delete(file.r2_key)
        await env.DB.batch([
          env.DB.prepare('DELETE FROM application_documents WHERE application_id = ?').bind(target.id),
          env.DB.prepare(`UPDATE applications SET applicant_name = '[파기됨]', applicant_email = ?, applicant_phone = '',
            career_json = NULL, application_source = NULL, cover_letter = NULL, ai_screening_json = NULL,
            lookup_code = NULL, created_user_id = NULL, purged_at = datetime('now') WHERE id = ?`)
            .bind(`deleted-${target.id}@invalid.example`, target.id),
        ])
      }
      await env.DB.prepare("UPDATE retention_jobs SET status = 'done', updated_at = datetime('now') WHERE id = ? AND lock_token = ?").bind(key, token).run()
      report.deleted++
    } catch {
      await env.DB.prepare("UPDATE retention_jobs SET status = 'failed', updated_at = datetime('now') WHERE id = ? AND lock_token = ?").bind(key, token).run()
      report.failed++
    }
  }
  await env.DB.prepare("DELETE FROM interview_signals WHERE datetime(created_at) < datetime('now', '-5 minutes')").run()
  return report
}
