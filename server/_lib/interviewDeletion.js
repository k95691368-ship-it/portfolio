export class InterviewDeletionError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'InterviewDeletionError'
    this.status = status
  }
}

// D1 cascade 전에 공급자에서 아직 끝나지 않은 작업과 R2 정본을 확인한다.
// 진행 중인 녹화/회의의 DB 키를 먼저 지우면 늦게 도착한 업로드가 고아 객체가
// 되므로, 정상 종료·취소된 세션만 정리할 수 있다.
export async function inspectInterviewRoomDeletion(env, roomIds) {
  const ids = [...new Set((roomIds || []).filter(Boolean))]
  if (ids.length === 0) return { ids, files: [] }
  const placeholders = ids.map(() => '?').join(',')

  const [active, filesResult] = await Promise.all([
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM interview_sessions
           WHERE room_id IN (${placeholders})
             AND status IN ('scheduled','waiting','live')) AS active_sessions,
         (SELECT COUNT(*) FROM interview_recordings recording
            JOIN interview_sessions session ON session.id = recording.session_id
           WHERE session.room_id IN (${placeholders})
             AND recording.deleted_at IS NULL
             AND recording.status IN ('starting','recording','paused','stopping','processing'))
           AS active_recordings`
    )
      .bind(...ids, ...ids)
      .first(),
    env.DB.prepare(
      `SELECT recording.r2_key
         FROM interview_recordings recording
         JOIN interview_sessions session ON session.id = recording.session_id
        WHERE session.room_id IN (${placeholders})
          AND recording.r2_key IS NOT NULL`
    )
      .bind(...ids)
      .all(),
  ])

  if (Number(active?.active_sessions) > 0 || Number(active?.active_recordings) > 0) {
    throw new InterviewDeletionError(
      '진행 중이거나 종료 처리가 끝나지 않은 화상 면접이 있어 삭제할 수 없습니다.',
      409
    )
  }

  const files = filesResult.results || []
  if (files.length && !env.INTERVIEW_RECORDINGS) {
    throw new InterviewDeletionError('화상 면접 녹화 보관소가 연결되지 않아 삭제를 중단했습니다.', 503)
  }
  return { ids, files }
}

export async function deleteInterviewRecordingFiles(env, inspection) {
  const files = inspection?.files || []
  if (files.length) {
    const deleted = await Promise.allSettled(
      files.map((recording) => env.INTERVIEW_RECORDINGS.delete(recording.r2_key))
    )
    if (deleted.some((result) => result.status === 'rejected')) {
      throw new InterviewDeletionError(
        '화상 면접 녹화 파일을 모두 삭제하지 못해 면접방 삭제를 중단했습니다.',
        503
      )
    }
  }
  return { recordingsDeleted: files.length }
}

export async function prepareInterviewRoomDeletion(env, roomIds) {
  const inspection = await inspectInterviewRoomDeletion(env, roomIds)
  return deleteInterviewRecordingFiles(env, inspection)
}

export async function acquireInterviewRoomDeletionLocks(env, roomIds, lockToken) {
  const ids = [...new Set((roomIds || []).filter(Boolean))]
  if (ids.length === 0) return { roomIds: ids, lockToken }
  try {
    await env.DB.batch(
      ids.flatMap((roomId) => [
        env.DB.prepare(
          `DELETE FROM interview_room_deletion_locks
            WHERE room_id = ? AND datetime(created_at) <= datetime('now', '-10 minutes')`
        ).bind(roomId),
        env.DB.prepare(
          'INSERT INTO interview_room_deletion_locks (room_id, lock_token) VALUES (?, ?)'
        ).bind(roomId, `${lockToken}:${roomId}`),
      ])
    )
  } catch (error) {
    console.error('Interview room deletion lock failed:', error)
    throw new InterviewDeletionError(
      '다른 요청이 화상 면접방을 변경하거나 삭제하고 있어 잠시 후 다시 시도해주세요.',
      409
    )
  }
  return { roomIds: ids, lockToken }
}

export async function releaseInterviewRoomDeletionLocks(env, lock) {
  const ids = lock?.roomIds || []
  if (ids.length === 0) return
  await env.DB.batch(
    ids.map((roomId) =>
      env.DB.prepare(
        'DELETE FROM interview_room_deletion_locks WHERE room_id = ? AND lock_token = ?'
      ).bind(roomId, `${lock.lockToken}:${roomId}`)
    )
  )
}
