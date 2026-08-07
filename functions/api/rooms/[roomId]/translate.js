import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { getRoomParticipant } from '../../../_lib/rooms.js'
import { rowToCamelTerms, buildArticlesForTranslation } from '../../../_lib/contract.js'
import { findLanguage } from '../../../_lib/languages.js'
import { translateContract } from '../../../_lib/claude.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import { notifyUser } from '../../../_lib/notify.js'
import { contractFingerprint } from '../../../_lib/contractDocument.js'

// 계약서를 근로자의 언어로 번역한다.
//
// 국내 외국인 근로자가 읽지 못하는 한국어 계약서에 서명하는 문제를 줄이기 위한
// 기능이다. 법적 효력은 한국어 원본에 있으며, 번역본은 이해를 돕기 위한 참고본임을
// 화면과 문서에 함께 표기한다.
export async function onRequestPost({ request, env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const participant = await getRoomParticipant(env, params.roomId, data.user.id)
  if (!participant) return jsonError('이 면접방에 참여하지 않았습니다.', 403)
  if (participant.role_in_room !== 'company') {
    return jsonError('계약서 번역은 회사(고용) 측만 요청할 수 있습니다.', 403)
  }

  const body = await request.json().catch(() => null)
  const language = findLanguage(body?.language)
  if (!language) return jsonError('지원하지 않는 언어입니다.', 400)

  const bucket = `translate:${params.roomId}`
  const ticket = await checkRateLimit(env, bucket, 5, 300)
  if (!ticket) return jsonError('번역 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)

  const termsRow = await env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?')
    .bind(params.roomId)
    .first()
  const terms = rowToCamelTerms(termsRow)
  // AI 초안이 있으면 그것을, 없으면 입력된 조건으로 만든 조항을 번역한다.
  const articles =
    terms?.aiDocument && terms.aiDocument.length > 0
      ? terms.aiDocument
      : buildArticlesForTranslation(terms)

  if (articles.length === 0) {
    await releaseRateLimit(env, bucket, ticket)
    return jsonError('번역할 계약 내용이 없습니다. 계약 조건을 먼저 입력해주세요.', 400)
  }

  let translated
  try {
    translated = await translateContract(env, {
      articles,
      languageLabel: `${language.label} (${language.nativeLabel})`,
    })
  } catch (err) {
    // 번역이 실패했는데 한도만 깎이면, 될 때까지 시도할 방법이 없어진다.
    await releaseRateLimit(env, bucket, ticket)
    return jsonError(err.message, 502)
  }

  // 조항 수가 어긋나면 대조가 불가능하므로 저장하지 않는다.
  if (translated.length !== articles.length) {
    await releaseRateLimit(env, bucket, ticket)
    return jsonError('번역 결과가 원본과 맞지 않습니다. 다시 시도해주세요.', 502)
  }

  const clean = translated.slice(0, articles.length).map((a) => ({
    heading: String(a.heading || '').slice(0, 300),
    body: String(a.body || '').slice(0, 4000),
  }))

  // 무엇을 옮긴 번역인지 함께 남긴다. 이 값이 있어야 나중에 조건이 바뀌었을 때
  // "이 번역본은 지금 계약서의 번역이 아니다"라고 말할 수 있다.
  const sourceSha256 = await contractFingerprint(terms)

  await env.DB.prepare(
    `INSERT INTO contract_translations (room_id, language, articles_json, translated_by_user_id, source_sha256)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(room_id, language) DO UPDATE SET
       articles_json = excluded.articles_json,
       translated_by_user_id = excluded.translated_by_user_id,
       source_sha256 = excluded.source_sha256,
       created_at = datetime('now')`
  )
    .bind(params.roomId, language.code, JSON.stringify(clean), data.user.id, sourceSha256)
    .run()

  const candidate = await env.DB.prepare(
    "SELECT user_id FROM room_participants WHERE room_id = ? AND role_in_room = 'candidate'"
  )
    .bind(params.roomId)
    .first()
  await notifyUser(env, candidate?.user_id, {
    type: 'contract_translated',
    message: `근로계약서 ${language.label} 번역본이 준비되었습니다.`,
    link: `/rooms/${params.roomId}/contract`,
  })

  return jsonResponse({ ok: true, language: language.code, articles: clean }, 201)
}
