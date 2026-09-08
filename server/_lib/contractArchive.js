// 체결된 근로계약서를 방 바깥에 보관한다.
//
// 지금까지 계약서 파일은 회사 담당자가 계약서 화면에서 버튼을 눌러야만
// 생겼다. 브라우저가 화면을 그림으로 찍어 PDF 로 만들고 그것을 올리는
// 방식이라, 아무도 누르지 않으면 아무것도 남지 않는다. 실제로 저장소가
// 비어 있었던 이유가 그것이다 -- 체결은 됐는데 보관된 것이 없었다.
//
// 보존은 회사가 기억해서 누르는 일이 아니다. 근로기준법 제42조는 사용자에게
// 계약서를 3년간 보존하라고 하고, 시행령 제22조 제2항은 그 기산일을 근로관계가
// 끝난 날로 정한다. 그래서 서명이 끝나는 그 순간 서버가 스스로 정본을 만들어
// 남긴다.
//
// 정본은 HTML 로 만든다. PDF 가 아닌 이유는 하나다 -- 이 서버(Workers)에서
// 한글이 들어간 PDF 를 만들려면 한글 글꼴을 통째로 실어야 하는데, 그것만으로
// 코드 묶음 한도를 넘는다. 그림으로 찍은 PDF 는 글자를 찾을 수도, 복사할 수도
// 없다. HTML 은 글자 그대로 남고, 브라우저에서 열어 그대로 인쇄하거나 PDF 로
// 저장할 수 있다. 보존해야 하는 것은 종이의 모양이 아니라 계약의 내용이다.
import { genId } from './db.js'
import { rowToCamelTerms, buildArticlesFromTerms } from './contract.js'
import { contractFingerprint } from './contractDocument.js'
import { describeVerificationMethod } from './auditCertificate.js'

const ARCHIVE_PREFIX = 'archive/contracts'

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 보존 만료일: 근로관계가 끝난 날부터 3년 (제42조 · 시행령 제22조 제2항).
// 아직 끝나지 않았으면 만료일이 없다 -- 재직 중에는 계속 보존한다.
export function retentionUntil(employmentEndedAt) {
  if (!employmentEndedAt) return null
  const d = new Date(`${String(employmentEndedAt).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCFullYear(d.getUTCFullYear() + 3)
  return d.toISOString().slice(0, 10)
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// 스스로 열리는 한 장짜리 정본. 바깥에서 불러오는 것이 하나도 없다.
//
// 글꼴도 그림도 링크도 바깥을 가리키지 않는다. 3년 뒤에 이 파일을 열었을 때
// 이 서비스가 살아 있지 않아도, 인터넷이 없어도 그대로 읽혀야 한다.
export function renderContractDocument(snapshot) {
  const { terms, signatures, roomId, signedAt, fingerprint, certificateSerial } = snapshot
  const articles = buildArticlesFromTerms(terms)

  const rows = [
    ['사업체명', terms.employerName],
    ['사업장 주소', terms.employerAddress],
    ['근로자 성명', terms.employeeName],
    ['근로자 주소', terms.employeeAddress],
  ].filter(([, v]) => v)

  const custom = Array.isArray(terms.customTerms)
    ? terms.customTerms.filter((c) => c && (c.label || c.value))
    : []

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>표준근로계약서 — ${esc(terms.employeeName || '')}</title>
<style>
  /* 글꼴은 이름만 적는다. 파일을 싣지 않아도 어느 컴퓨터에서든 한글이 나온다. */
  body { font-family: "SUIT Variable", SUIT, -apple-system, BlinkMacSystemFont,
         "SF Pro Text", "SF Pro Display", "Apple SD Gothic Neo", "Helvetica Neue",
         "Noto Sans KR", "Malgun Gothic",
         "맑은 고딕", "Segoe UI", Arial, sans-serif;
         max-width: 760px; margin: 0 auto; padding: 32px 24px; color: #111; line-height: 1.7; }
  h1 { font-size: 24px; text-align: center; margin: 0 0 4px; }
  .sub { text-align: center; color: #555; font-size: 13px; margin: 0 0 28px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th, td { border: 1px solid #ccc; padding: 8px 10px; font-size: 14px; text-align: left;
           vertical-align: top; word-break: keep-all; }
  th { width: 30%; background: #f5f5f5; font-weight: 600; }
  .article { margin-bottom: 14px; }
  .article h2 { font-size: 15px; margin: 0 0 3px; }
  .article p { margin: 0; font-size: 14px; white-space: pre-wrap; }
  .signs { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 32px; }
  .sign { flex: 1 1 240px; border: 1px solid #ccc; padding: 12px; }
  .sign img { max-width: 100%; height: 76px; object-fit: contain; }
  .sign dt { font-size: 12px; color: #555; margin-top: 6px; }
  .sign dd { margin: 0; font-size: 13px; word-break: break-all; }
  .meta { margin-top: 32px; padding-top: 14px; border-top: 1px solid #ddd;
          font-size: 12px; color: #555; word-break: break-all; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<h1>표준근로계약서</h1>
<p class="sub">전자적으로 체결·보관된 정본입니다.</p>

<table>
${rows.map(([k, v]) => `  <tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('\n')}
</table>

${articles
  .map(
    (a) => `<div class="article"><h2>${esc(a.heading)}</h2><p>${esc(a.body)}</p></div>`
  )
  .join('\n')}

${
  custom.length > 0
    ? `<div class="article"><h2>그 밖의 사항</h2><p>${custom
        .map((c) => esc([c.label, c.value].filter(Boolean).join(': ')))
        .join('\n')}</p></div>`
    : ''
}

<div class="signs">
${signatures
  .map(
    (s) => `  <div class="sign">
    ${s.imageDataUrl ? `<img src="${esc(s.imageDataUrl)}" alt="${esc(s.signerName || '')} 서명">` : '<p>(서명 이미지 없음)</p>'}
    <dl>
      <dt>${s.signerRole === 'company' ? '사업주' : '근로자'}</dt>
      <dd>${esc(s.signerName || '')}</dd>
      <dt>서명일시 (KST)</dt>
      <dd>${esc(s.signedAt || '')}</dd>
      <dt>인증 방법</dt>
      <dd>${esc(s.verification?.label || '기록 없음')}</dd>
    </dl>
  </div>`
  )
  .join('\n')}
</div>

<div class="meta">
  <p>문서 지문 (SHA-256, 계약 내용): ${esc(fingerprint || '없음')}</p>
  <p>감사추적증명서 일련번호: ${esc(certificateSerial || '미발급')}</p>
  <p>원본 면접방: ${esc(roomId)}</p>
  <p>체결 완료: ${esc(signedAt || '')}</p>
  <p>보존 근거: 근로기준법 제42조, 같은 법 시행령 제22조 제2항 (근로관계가 끝난 날부터 3년)</p>
</div>
</body>
</html>
`
}

// 방 하나를 보관한다. 여러 번 불러도 결과가 같다.
//
// 서명이 끝나는 길목에서 불리므로, 여기서 던지면 서명 자체가 실패한다.
// 보관에 실패해도 서명은 성립해야 하므로 부르는 쪽에서 삼킨다 -- 다만
// 조용히 넘기지는 않고, 관리자 화면에서 다시 보관할 수 있게 해 둔다.
export async function archiveContract(env, roomId) {
  const room = await env.DB.prepare(
    'SELECT id, title, status FROM interview_rooms WHERE id = ?'
  )
    .bind(roomId)
    .first()
  if (!room) return { ok: false, reason: '면접방을 찾을 수 없습니다.' }
  if (room.status !== 'signed') return { ok: false, reason: '아직 체결되지 않은 계약입니다.' }

  const [termsRow, sigResult, participants, certificate, existing] = await Promise.all([
    env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?').bind(roomId).first(),
    env.DB.prepare(
      `SELECT s.signer_role, s.signer_user_id, s.image_data_url, s.signed_at,
              s.document_sha256, s.verification_method, s.verified_email,
              s.session_started_at, u.display_name
         FROM signatures s LEFT JOIN users u ON u.id = s.signer_user_id
        WHERE s.room_id = ? ORDER BY s.signed_at`
    )
      .bind(roomId)
      .all(),
    env.DB.prepare(
      `SELECT u.id, u.email, u.display_name, rp.role_in_room
         FROM room_participants rp JOIN users u ON u.id = rp.user_id
        WHERE rp.room_id = ?`
    )
      .bind(roomId)
      .all(),
    env.DB.prepare(
      'SELECT serial FROM audit_certificates WHERE room_id = ? ORDER BY issued_at DESC LIMIT 1'
    )
      .bind(roomId)
      .first(),
    env.DB.prepare('SELECT id, document_key FROM contract_archive WHERE room_id = ?')
      .bind(roomId)
      .first(),
  ])

  if (!termsRow) return { ok: false, reason: '계약 조건이 없습니다.' }

  const terms = rowToCamelTerms(termsRow)
  const signatures = (sigResult?.results || []).map((s) => ({
    signerRole: s.signer_role,
    signerUserId: s.signer_user_id,
    signerName: s.display_name,
    signedAt: s.signed_at,
    imageDataUrl: s.image_data_url,
    fingerprint: s.document_sha256,
    // 무엇으로 본인을 확인했는지는 증명서와 같은 문장을 쓴다. 두 곳에서
    // 따로 지어 내면 한쪽만 고쳐져 서로 다른 말을 하게 된다.
    verification: describeVerificationMethod(s),
  }))

  const members = participants?.results || []
  const candidate = members.find((m) => m.role_in_room === 'candidate')
  const company = members.find((m) => m.role_in_room === 'company')
  const signedAt = signatures.length ? signatures[signatures.length - 1].signedAt : null

  // 서명 행에 지문이 남아 있으면 그것을 그대로 쓴다. 여기서 다시 계산한
  // 값으로 덮으면, 서명 뒤에 조건이 바뀐 계약도 멀쩡해 보이게 된다.
  const fingerprint =
    signatures.find((s) => s.fingerprint)?.fingerprint || (await contractFingerprint(terms))

  const snapshot = {
    terms,
    signatures,
    roomId,
    signedAt,
    fingerprint,
    certificateSerial: certificate?.serial || null,
  }
  const html = renderContractDocument(snapshot)
  const bytes = new TextEncoder().encode(html)
  const documentSha = await sha256Hex(bytes)

  const id = existing?.id || genId()
  // 저장할 때마다 새 키를 쓴다. 같은 키에 덮어썼다가 DB 쓰기가 실패하면
  // 파일은 새것인데 기록된 지문은 옛것이 되고, 그 계약서는 대조할 때마다
  // 영원히 "변조됨" 으로 나온다 -- 아무도 손대지 않았는데.
  const documentKey = `${ARCHIVE_PREFIX}/${id}/${Date.now()}.html`

  await env.DOCUMENTS.put(documentKey, bytes, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  })

  const employmentEndedAt = terms.employmentEndedAt || null

  try {
    await env.DB.prepare(
      `INSERT INTO contract_archive
         (id, room_id, room_title, employer_name, employer_user_id,
          employee_name, employee_user_id, employee_email,
          contract_start_date, contract_end_date, employment_ended_at, signed_at,
          retention_until, terms_json, signatures_json, fingerprint, certificate_serial,
          document_key, document_sha256, document_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(room_id) DO UPDATE SET
         room_title = excluded.room_title,
         employer_name = excluded.employer_name,
         employee_name = excluded.employee_name,
         employee_email = excluded.employee_email,
         contract_start_date = excluded.contract_start_date,
         contract_end_date = excluded.contract_end_date,
         employment_ended_at = excluded.employment_ended_at,
         signed_at = excluded.signed_at,
         retention_until = excluded.retention_until,
         terms_json = excluded.terms_json,
         signatures_json = excluded.signatures_json,
         fingerprint = excluded.fingerprint,
         certificate_serial = excluded.certificate_serial,
         document_key = excluded.document_key,
         document_sha256 = excluded.document_sha256,
         document_bytes = excluded.document_bytes,
         updated_at = datetime('now')`
    )
      .bind(
        id,
        roomId,
        room.title,
        terms.employerName || company?.display_name || null,
        company?.id || null,
        terms.employeeName || candidate?.display_name || null,
        candidate?.id || null,
        candidate?.email || null,
        terms.contractStartDate || null,
        terms.contractEndDate || null,
        employmentEndedAt,
        signedAt,
        retentionUntil(employmentEndedAt),
        JSON.stringify(terms),
        JSON.stringify(signatures),
        fingerprint,
        certificate?.serial || null,
        documentKey,
        documentSha,
        bytes.length
      )
      .run()
  } catch (err) {
    console.error(`contract archive write failed (${roomId}):`, err)
    // 기록이 가리키는 것은 여전히 옛 파일이다. 방금 올린 것만 치운다.
    await env.DOCUMENTS.delete(documentKey).catch(() => {})
    return { ok: false, reason: '보관 기록을 남기지 못했습니다.' }
  }

  // 기록이 새 파일을 가리킨 뒤에 옛 파일을 치운다. 여기서 실패해도 남는 것은
  // 아무도 가리키지 않는 객체뿐이라, 계약서가 사라지는 일은 없다.
  if (existing?.document_key && existing.document_key !== documentKey) {
    await env.DOCUMENTS.delete(existing.document_key).catch(() => {})
  }

  return { ok: true, id, documentKey, bytes: bytes.length }
}

// 서명이 끝나는 길목에서 부른다. 여기서 던지면 서명이 실패하므로 삼킨다.
export async function archiveContractQuietly(env, roomId) {
  try {
    return await archiveContract(env, roomId)
  } catch (err) {
    console.error(`contract archive threw (${roomId}):`, err)
    return { ok: false, reason: String(err?.message || err).slice(0, 200) }
  }
}
