export function recordingFilePrefix(recordingId) {
  const id = String(recordingId || '').replace(/[^A-Za-z0-9_]/g, '_')
  if (!id || id.length > 90) throw new TypeError('녹화 식별자를 확인할 수 없습니다.')
  return `recording_${id}`
}

function directR2BasePath(value) {
  const path = String(value || '').trim().replace(/^\/+|\/+$/g, '')
  if (!path || path.length > 240) return null
  const segments = path.split('/')
  if (segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) return null
  return segments.join('/')
}

export function getDirectRecordingPath(env) {
  return directR2BasePath(env?.REALTIMEKIT_DIRECT_R2_PATH)
}

function hasUnsafeObjectNameCharacters(name) {
  for (const character of name) {
    const codePoint = character.codePointAt(0)
    if (
      character === '/' ||
      character === '\\' ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
      return true
    }
  }
  return false
}

export function directRecordingKey(env, { id, filename }) {
  const path = getDirectRecordingPath(env)
  const name = String(filename || '')
  if (
    !path ||
    !name ||
    name.length > 255 ||
    hasUnsafeObjectNameCharacters(name)
  ) {
    return null
  }
  if (name === '.' || name === '..' || !name.startsWith(`${recordingFilePrefix(id)}_`)) {
    return null
  }
  return `${path}/${name}`
}

// 앱 수준 Recording Storage가 같은 R2 버킷을 가리킬 때, RTK가 이미 올린
// 객체를 HEAD로 확인하고 정본으로 채택한다. 키는 서버가 발급한 로컬 ID 접두사와
// 안전한 basename을 모두 확인한 뒤에만 만든다.
export async function adoptDirectRecordingFromR2(env, recording) {
  const key = directRecordingKey(env, recording)
  if (!key || !env.INTERVIEW_RECORDINGS) return null

  let stored
  try {
    stored = await env.INTERVIEW_RECORDINGS.head(key)
  } catch (error) {
    console.error(`Direct recording R2 head failed (${recording.id}):`, error)
    return null
  }
  if (!stored) return null

  const contentType = stored.httpMetadata?.contentType || 'video/mp4'
  const updated = await env.DB.prepare(
    `UPDATE interview_recordings
        SET r2_key = ?, storage_status = 'stored', status = 'available',
            size_bytes = COALESCE(?, size_bytes), content_type = ?,
            filename = COALESCE(?, filename), stopped_at = COALESCE(?, stopped_at),
            retention_until = COALESCE(
              datetime(?, '+30 days'),
              datetime(stopped_at, '+30 days'),
              datetime('now', '+30 days')
            ),
            provider_download_url = NULL, provider_download_url_expires_at = NULL,
            failure_reason = NULL, updated_at = datetime('now')
      WHERE id = ? AND deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
            FROM interview_sessions session
            JOIN interview_room_deletion_locks deletion_lock
              ON deletion_lock.room_id = session.room_id
           WHERE session.id = interview_recordings.session_id
             AND datetime(deletion_lock.created_at) > datetime('now', '-10 minutes')
        )`
  )
    .bind(
      key,
      stored.size,
      contentType,
      recording.filename,
      recording.stoppedAt ?? recording.stopped_at ?? null,
      recording.stoppedAt ?? recording.stopped_at ?? null,
      recording.id
    )
    .run()
  if (updated.meta?.changes === 0) {
    // 관리자 삭제 잠금 뒤에는 DB가 객체 키를 채택할 수 없다. 방 삭제와
    // 엇갈려 방금 나타난 direct-upload 객체도 즉시 지워 고아 파일을 남기지 않는다.
    try {
      await env.INTERVIEW_RECORDINGS.delete(key)
    } catch (error) {
      console.error(`Locked direct recording cleanup failed (${recording.id}):`, error)
      throw new Error('locked_recording_cleanup_failed')
    }
    return null
  }
  return { key, size: stored.size, contentType }
}
