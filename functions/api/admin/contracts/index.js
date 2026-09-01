import { jsonResponse } from '../../../_lib/http.js'

// 관리: 체결된 근로계약서를 한자리에서 본다.
//
// 지금까지 계약서를 찾으려면 면접방을 하나씩 열어야 했다. 방은 채용이 진행되는
// 자리라 끝난 계약을 찾는 데에는 맞지 않는다 -- 근로기준법 제42조는 근로관계가
// 끝난 날부터 3년간 계약서를 보존하라고 하는데, 그러려면 "무엇이 어디 있는가"를
// 한눈에 볼 자리가 있어야 한다.
//
// 파일 자체는 여기서 내려주지 않는다. 목록과 위치만 준다. 실제 파일은 기존
// 경로(/api/rooms/:roomId/signed-contract-file)가 권한을 확인하고 내보낸다 --
// 내려받는 문을 두 개 두면 한쪽만 고쳤을 때 다른 쪽이 열린 채로 남는다.
const MAX_ROWS = 500

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT sc.id, sc.room_id, sc.filename, sc.size_bytes, sc.email_status,
            sc.emailed_at, sc.created_at,
            r.title AS room_title, r.status AS room_status, r.archived_at,
            t.employer_name, t.employee_name, t.contract_start_date, t.contract_end_date,
            t.employment_ended_at, t.wage_base_amount,
            (SELECT COUNT(*) FROM signatures s WHERE s.room_id = sc.room_id) AS signature_count,
            (SELECT MAX(s.signed_at) FROM signatures s WHERE s.room_id = sc.room_id) AS signed_at,
            (SELECT c.serial FROM audit_certificates c WHERE c.room_id = sc.room_id
              ORDER BY c.issued_at DESC LIMIT 1) AS certificate_serial
       FROM signed_contracts sc
       JOIN interview_rooms r ON r.id = sc.room_id
       LEFT JOIN contract_terms t ON t.room_id = sc.room_id
      ORDER BY sc.created_at DESC
      LIMIT ?`
  )
    .bind(MAX_ROWS)
    .all()

  return jsonResponse({
    truncated: results.length >= MAX_ROWS,
    limit: MAX_ROWS,
    contracts: results.map((c) => ({
      id: c.id,
      roomId: c.room_id,
      roomTitle: c.room_title,
      roomStatus: c.room_status,
      archivedAt: c.archived_at ?? null,
      filename: c.filename,
      sizeBytes: c.size_bytes,
      employerName: c.employer_name ?? null,
      employeeName: c.employee_name ?? null,
      contractStartDate: c.contract_start_date ?? null,
      contractEndDate: c.contract_end_date ?? null,
      // 보존 기간은 '근로관계가 끝난 날'부터 센다(제42조·시행령 제22조 제2항).
      // 그 날짜가 비어 있으면 아직 세기 시작하지 않은 것이다.
      employmentEndedAt: c.employment_ended_at ?? null,
      wageBaseAmount: c.wage_base_amount ?? null,
      signatureCount: c.signature_count ?? 0,
      signedAt: c.signed_at ?? null,
      certificateSerial: c.certificate_serial ?? null,
      emailStatus: c.email_status,
      emailedAt: c.emailed_at ?? null,
      storedAt: c.created_at,
    })),
  })
}
