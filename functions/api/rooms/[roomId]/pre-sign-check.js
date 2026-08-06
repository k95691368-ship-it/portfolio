import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomAccess } from '../../../_lib/rooms.js'
import { rowToCamelTerms } from '../../../_lib/contract.js'
import { checkLegalCompliance, findMissingFields, diffAgreedVsCurrent } from '../../../_lib/contractCheck.js'
import { checkProbationCompliance } from '../../../_lib/probation.js'
import { checkPeriodCompliance } from '../../../_lib/contractPeriod.js'

// 서명 전 최종 안전 점검.
// 채팅 합의 내용과 현재 계약서의 차이, 최종 조건 기준 법적 재검토, 필수 누락을
// 한 번에 돌려준다. 서명 당사자 양측과 관리자가 모두 조회할 수 있다.
export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)
  const access = await getRoomAccess(env, params.roomId, data.user)
  if (!access) return jsonError('이 면접방에 참여하지 않았습니다.', 403)

  const termsRow = await env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()
  if (!termsRow) {
    return jsonResponse({ ready: false, diffs: [], legalIssues: [], missingFields: [] })
  }

  const terms = rowToCamelTerms(termsRow)

  // 수정 이력은 오래된 것부터 필요 (각 필드의 최초 from = 합의 값)
  const { results: history } = await env.DB.prepare(
    'SELECT changes, source FROM contract_edit_history WHERE room_id = ? ORDER BY id ASC'
  )
    .bind(params.roomId)
    .all()

  const parsedHistory = history.map((h) => {
    try {
      return { changes: JSON.parse(h.changes), source: h.source }
    } catch {
      return { changes: [], source: h.source }
    }
  })

  const diffs = diffAgreedVsCurrent(parsedHistory, terms)
  const legalIssues = [
    ...checkLegalCompliance(terms),
    ...checkPeriodCompliance(terms),
    ...checkProbationCompliance(terms),
  ]
  const missingFields = findMissingFields(terms)

  const hasBlocking =
    legalIssues.some((i) => i.severity === 'high') || diffs.length > 0 || missingFields.length > 0

  return jsonResponse({
    ready: true,
    diffs,
    legalIssues,
    missingFields,
    hasBlocking,
    checkedAt: new Date().toISOString(),
  })
}
