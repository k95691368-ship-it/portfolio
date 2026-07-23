// Returns true if the action is allowed (and records the hit), false if the
// bucket has already reached maxHits within the trailing windowSeconds.
export async function checkRateLimit(env, bucket, maxHits, windowSeconds) {
  await env.DB.prepare(
    `DELETE FROM rate_limit_hits WHERE bucket = ? AND created_at < datetime('now', '-' || ? || ' seconds')`
  )
    .bind(bucket, windowSeconds)
    .run()

  // 가끔 전역 청소: 다시 조회되지 않는 콜드 버킷(예: 1회성 IP)의 오래된 행이
  // 무한히 누적되는 것을 막는다. 가장 긴 윈도가 1시간이므로 1일 지난 행은 항상 무의미.
  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM rate_limit_hits WHERE created_at < datetime('now', '-1 day')")
      .run()
      .catch(() => {})
  }

  const row = await env.DB.prepare('SELECT COUNT(*) AS count FROM rate_limit_hits WHERE bucket = ?')
    .bind(bucket)
    .first()
  if (row.count >= maxHits) return false

  await env.DB.prepare('INSERT INTO rate_limit_hits (bucket) VALUES (?)').bind(bucket).run()
  return true
}
