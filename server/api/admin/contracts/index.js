import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { archiveContract } from '../../../_lib/contractArchive.js'
import { logAdminAction } from '../../../_lib/auditLog.js'

// 근로계약서 영구 보관소.
//
// 목록의 기준은 면접방이 아니라 보관소다. 처음에는 방과 저장된 PDF 를 이어
// 붙여 목록을 만들었는데, 그러면 두 가지가 통째로 빠진다 -- 서명은 끝났지만
// 아무도 저장 버튼을 누르지 않은 계약과, 방이 지워진 계약이다. 둘 다
// 보존해야 하는 계약서인데 화면에는 없었다.
//
// 이제 체결되는 순간 서버가 스스로 보관하므로(contractArchive.js), 여기서는
// 보관된 것을 그대로 보여 준다.
const MAX_ROWS = 500

export async function onRequestGet({ env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.room_id, a.room_title, a.employer_name, a.employee_name,
            a.employee_email, a.contract_start_date, a.contract_end_date,
            a.employment_ended_at, a.signed_at, a.retention_until,
            a.fingerprint, a.certificate_serial, a.document_bytes,
            a.created_at, a.source_deleted_at,
            json_array_length(a.signatures_json) AS signature_count,
            -- 방이 아직 살아 있는가. 없으면 계약서만 남은 것이다.
            (SELECT 1 FROM interview_rooms r WHERE r.id = a.room_id) AS room_alive,
            -- 회사가 따로 올려 둔 PDF 사본이 있는가(있으면 그것도 내려받게 한다).
            (SELECT 1 FROM signed_contracts sc WHERE sc.room_id = a.room_id) AS has_pdf
       FROM contract_archive a
      ORDER BY COALESCE(a.signed_at, a.created_at) DESC
      LIMIT ?`
  )
    .bind(MAX_ROWS)
    .all()

  // 아직 보관되지 않은 체결 계약이 있는가. 이 기능을 붙이기 전에 체결된
  // 계약들이 여기에 잡힌다. 몇 건인지 알려 주고, 아래 POST 로 마저 보관한다.
  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM interview_rooms r
      WHERE r.status = 'signed'
        AND NOT EXISTS (SELECT 1 FROM contract_archive a WHERE a.room_id = r.id)`
  ).first()

  return jsonResponse({
    contracts: (results || []).map((c) => ({
      id: c.id,
      roomId: c.room_id,
      roomTitle: c.room_title,
      employerName: c.employer_name,
      employeeName: c.employee_name,
      employeeEmail: c.employee_email,
      contractStartDate: c.contract_start_date,
      contractEndDate: c.contract_end_date,
      employmentEndedAt: c.employment_ended_at,
      signedAt: c.signed_at,
      retentionUntil: c.retention_until,
      fingerprint: c.fingerprint,
      certificateSerial: c.certificate_serial,
      documentBytes: c.document_bytes,
      archivedAt: c.created_at,
      // 방이 지워졌는지. 지워졌어도 계약서는 여기 그대로 있다.
      roomDeleted: !!c.source_deleted_at || !c.room_alive,
      sourceDeletedAt: c.source_deleted_at,
      hasPdfCopy: !!c.has_pdf,
      signatureCount: Number(c.signature_count || 0),
    })),
    pendingCount: Number(pending?.n ?? 0),
    limit: MAX_ROWS,
    truncated: (results || []).length >= MAX_ROWS,
  })
}

// 아직 보관되지 않은 체결 계약을 마저 보관한다.
//
// 자동 보관은 이 기능을 붙인 뒤 체결된 계약에만 걸린다. 그 전에 체결된
// 계약서도 보존 대상이므로, 관리자가 눌러 채울 수 있게 해 둔다. 이미 보관된
// 것은 다시 보관해도 결과가 같다.
export async function onRequestPost({ env, data }) {
  if (!data.user) return jsonError('로그인이 필요합니다.', 401)

  const { results } = await env.DB.prepare(
    `SELECT r.id FROM interview_rooms r
      WHERE r.status = 'signed'
        AND NOT EXISTS (SELECT 1 FROM contract_archive a WHERE a.room_id = r.id)
      LIMIT 100`
  ).all()

  let stored = 0
  const failed = []
  for (const row of results || []) {
    // 한 건이 실패해도 나머지는 보관한다. 하나 때문에 전부 못 남기면
    // 보존 의무가 있는 계약서가 계속 밖에 있게 된다.
    try {
      const r = await archiveContract(env, row.id)
      if (r.ok) stored += 1
      else failed.push({ roomId: row.id, reason: r.reason })
    } catch (err) {
      failed.push({ roomId: row.id, reason: String(err?.message || err).slice(0, 150) })
    }
  }

  if (stored > 0) {
    await logAdminAction(env, {
      actorId: data.user.id,
      action: 'archive_contracts',
      detail: `보관 ${stored}건${failed.length ? ` · 실패 ${failed.length}건` : ''}`,
    })
  }

  return jsonResponse({ ok: true, stored, failed })
}
