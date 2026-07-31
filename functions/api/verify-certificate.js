import { jsonResponse, jsonError } from '../_lib/http.js'
import { checkRateLimit } from '../_lib/rateLimit.js'
import { parseSerial, certificateFingerprint, verifyCertificate } from '../_lib/auditCertificate.js'

// 공개: 발급번호로 감사추적증명서의 진위를 확인한다. 로그인 불필요.
//
// 증명서는 계약 당사자가 아닌 사람(근로감독관, 법률 상담, 은행)에게 제시된다.
// 그 사람이 이 앱의 계정을 만들어야만 확인할 수 있다면 증명서로서 쓸모가 없다.
//
// 확인은 "발급 시 동결해 둔 원본 문자열을 다시 해시해 저장된 지문과 대조"하는
// 방식이다. 이러면 나중에 직렬화 규칙을 바꿔도 옛 증명서가 변조로 뒤집히지 않는다.
//
// 계약 내용 자체는 돌려주지 않는다. 진위 확인에 필요한 것은 발급 사실과 지문이지
// 근로조건이 아니고, 발급번호를 아는 것만으로 남의 임금이 보여서는 안 된다.
export async function onRequestGet({ request, env }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const allowed = await checkRateLimit(env, `verify-cert:${ip}`, 30, 600)
  if (!allowed) return jsonError('확인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)

  const url = new URL(request.url)
  const serial = parseSerial(url.searchParams.get('serial'))
  if (!serial) {
    return jsonError('발급번호를 AC-XXXX-XXXX-XXXX 형식으로 입력해주세요.', 400)
  }

  const row = await env.DB.prepare(
    `SELECT serial, issued_at, certificate_sha256, canonical_text, document_sha256,
            event_count, revoked_at
       FROM audit_certificates WHERE serial = ?`
  )
    .bind(serial)
    .first()

  if (!row) {
    return jsonError('그 발급번호로 발급된 증명서가 없습니다.', 404)
  }

  const recomputed = await certificateFingerprint(row.canonical_text)
  const provided = url.searchParams.get('sha256')
  const result = verifyCertificate({
    storedSha256: row.certificate_sha256,
    recomputedSha256: recomputed,
    providedSha256: provided ? String(provided).trim().toLowerCase() : null,
    revokedAt: row.revoked_at,
  })

  return jsonResponse({
    serial: row.serial,
    issuedAt: row.issued_at,
    certificateSha256: row.certificate_sha256,
    documentSha256: row.document_sha256,
    eventCount: row.event_count,
    ...result,
  })
}
