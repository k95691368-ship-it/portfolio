import { jsonError, jsonResponse } from '../../../../../../_lib/http.js'
import {
  InterviewAccessError,
  getInterviewSessionAccess,
  loadSessionForUser,
  loadSessionRecordings,
  serializeRecording,
} from '../../../../../../_lib/interviews.js'

export async function onRequestGet({ env, data, params }) {
  let access
  try {
    access = await getInterviewSessionAccess(
      env,
      params.roomId,
      params.sessionId,
      data.user
    )
  } catch (error) {
    if (error instanceof InterviewAccessError) return jsonError(error.message, error.status)
    throw error
  }

  const session = await loadSessionForUser(
    env,
    params.roomId,
    params.sessionId,
    data.user.id
  )
  if (!session) return jsonError('화상 면접을 찾을 수 없습니다.', 404)
  if (!session.my_role && access.roomRole !== 'admin') {
    return jsonError('이 화상 면접의 참가자가 아닙니다.', 403)
  }

  const rows = await loadSessionRecordings(env, params.sessionId)
  return jsonResponse({ recordings: rows.map(serializeRecording) })
}
