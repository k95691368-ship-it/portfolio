import { jsonResponse } from '../../../_lib/http.js'
import { requireManageableApplication, parseCareer } from '../../../_lib/applications.js'
import { offerStatusForApplication } from '../../../_lib/offerFromEmail.js'

// 관리: 지원서 상세 (경력·동의·첨부파일 포함).
export async function onRequestGet({ env, data, params }) {
  const access = await requireManageableApplication(env, data.user, params.id)
  if (access.error) return access.error
  const a = access.application

  // 첨부 목록과 채용내정 성립 여부를 함께 읽는다.
  //
  // 화면이 탈락 버튼을 내릴지 정하려면 이 값이 필요하다. 서버만 막고 화면은
  // 그대로 두면, 담당자는 누를 수 있는 줄 알고 눌렀다가 거절당한다 — 막는
  // 것이 목적이라면 누르기 전에 보여야 한다.
  const [docsResult, offer] = await Promise.all([
    env.DB.prepare(
      `SELECT id, doc_type, filename, size_bytes FROM application_documents WHERE application_id = ?`
    )
      .bind(params.id)
      .all(),
    offerStatusForApplication(env, a),
  ])

  // 서류합격한 지원자에게 건네야 하는 값이다. 담당자가 언제든 다시 보거나
  // 다시 보낼 수 있어야 한다 — 코드가 전해지지 않으면 지원자는 면접방에
  // 들어올 수 없고, 그러면 계약도 서명도 시작되지 않는다.
  const room = a.room_id
    ? await env.DB.prepare('SELECT invite_code FROM interview_rooms WHERE id = ?')
        .bind(a.room_id)
        .first()
    : null
  const docs = docsResult.results

  return jsonResponse({
    application: {
      id: a.id,
      postingId: a.posting_id,
      postingTitle: a.posting_title,
      applicantName: a.applicant_name,
      applicantEmail: a.applicant_email,
      applicantPhone: a.applicant_phone,
      career: parseCareer(a.career_json),
      applicationSource: a.application_source,
      coverLetter: a.cover_letter,
      consent: {
        required: !!a.consent_required,
        optional: !!a.consent_optional,
        thirdParty: !!a.consent_third_party,
        consentedAt: a.consented_at,
      },
      status: a.status,
      roomId: a.room_id,
      createdUserId: a.created_user_id,
      reviewedAt: a.reviewed_at,
      createdAt: a.created_at,
      // 심사 결과가 깨져 있어도 지원서 자체는 열려야 한다.
      aiScreening: (() => {
        if (!a.ai_screening_json) return null
        try {
          return JSON.parse(a.ai_screening_json)
        } catch {
          return null
        }
      })(),
      screenedAt: a.screened_at,
      roomId: a.room_id ?? null,
      inviteCode: room?.invite_code ?? null,
      // 채용내정이 성립했으면 이 사람은 탈락시킬 수 없다.
      offer,
      documents: docs.map((d) => ({
        id: d.id,
        docType: d.doc_type,
        filename: d.filename,
        sizeBytes: d.size_bytes,
      })),
    },
  })
}
