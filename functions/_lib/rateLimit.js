// Returns true if the action is allowed (and records the hit), false if the
// bucket has already reached maxHits within the trailing windowSeconds.
export async function checkRateLimit(env, bucket, maxHits, windowSeconds) {
  await env.DB.prepare(
    `DELETE FROM rate_limit_hits WHERE bucket = ? AND created_at < datetime('now', '-' || ? || ' seconds')`
  )
    .bind(bucket, windowSeconds)
    .run()

  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM rate_limit_hits WHERE bucket = ?')
    .bind(bucket)
    .first()
  if (row.count >= maxHits) return false

  await env.DB.prepare('INSERT INTO rate_limit_hits (bucket) VALUES (?)').bind(bucket).run()
  return true
}
