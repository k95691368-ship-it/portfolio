import { jsonError } from '../../../../_lib/http.js'

// 보관된 정본을 내려받는다.
//
// 방을 지나지 않는다. 기존 계약서 파일 내려받기는 면접방 참여자인지를 보는데,
// 방이 사라진 계약서는 그 검사를 통과할 방법이 아예 없다 -- 참여자 표도 함께
// 지워졌기 때문이다. 보관소의 문은 관리자 하나로 잠근다(이 경로는
// admin/_middleware.js 가 이미 관리자만 통과시킨다).
export async function onRequestGet({ env, data, params }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const row = await env.DB.prepare(
    'SELECT document_key, employee_name, signed_at FROM contract_archive WHERE id = ?'
  )
    .bind(params.id)
    .first()
  if (!row) return jsonError('보관된 계약서를 찾을 수 없습니다.', 404)

  const object = await env.DOCUMENTS.get(row.document_key)
  if (!object) {
    // 기록은 있는데 파일이 없다. 조용히 404 를 주면 "원래 없었다"로 읽힌다.
    console.error(`archive object missing: ${row.document_key}`)
    return jsonError('보관된 파일을 찾지 못했습니다. 관리자에게 문의하세요.', 410)
  }

  const name = `근로계약서_${(row.employee_name || '무명').replace(/[^가-힣A-Za-z0-9]/g, '')}_${(row.signed_at || '').slice(0, 10)}.html`

  return new Response(object.body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // 보관된 문서를 브라우저가 이 사이트의 화면인 것처럼 실행하지 않게 한다.
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      'cache-control': 'private, no-store',
    },
  })
}
