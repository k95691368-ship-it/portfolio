import { jsonResponse } from '../../../_lib/http.js'
import { requireManageableApplication, parseCareer } from '../../../_lib/applications.js'

// 관리: 지원서 상세 (경력·동의·첨부파일 포함).
export async function onRequestGet({ env, data, params }) {
  const access = await requireManageableApplication(env, data.user, params.id)
  if (access.error) return access.error
  const a = access.application

  const { results: docs } = await env.DB.prepare(
    `SELECT id, doc_type, filename, size_bytes FROM application_documents WHERE application_id = ?`
  )
    .bind(params.id)
    .all()

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
      aiScreening: a.ai_screening_json ? JSON.parse(a.ai_screening_json) : null,
      screenedAt: a.screened_at,
      documents: docs.map((d) => ({
        id: d.id,
        docType: d.doc_type,
        filename: d.filename,
        sizeBytes: d.size_bytes,
      })),
    },
  })
}
