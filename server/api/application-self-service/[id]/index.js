import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { requireApplicationAccess, applicationSelfView } from '../../../_lib/applicationAccess.js'
import { validateApplication, normalizeCareer, parseBool } from '../../../_lib/application.js'
import { validateUploadFile, validateFileContent, fileExt, mimeForExt } from '../../../_lib/uploads.js'
import { genId } from '../../../_lib/db.js'
import { CONSENT_VERSION, CONSENT_SNAPSHOT } from '../../../../src/lib/consentText.js'
import { checkRateLimit } from '../../../_lib/rateLimit.js'
import { stageApplicationUpload, settleApplicationUpload } from '../../../_lib/applicationUploadCleanup.js'

export async function onRequestGet(context) {
  const access = await requireApplicationAccess(context, context.params.id)
  return access.error || jsonResponse({ application: await applicationSelfView(context.env, access.application) })
}

export async function onRequestPatch(context) {
  const { env, request, params } = context
  const access = await requireApplicationAccess(context, params.id)
  if (access.error) return access.error
  const current = access.application
  if (current.status !== 'submitted' || current.withdrawn_at || current.posting_status !== 'open' || current.posting_expired) {
    return jsonError('심사 전이며 모집 중인 지원서만 수정할 수 있습니다.', 409)
  }
  if (!await checkRateLimit(env, `application-edit:${params.id}`, 10, 3600)) return jsonError('잠시 후 다시 시도해주세요.', 429)
  const form = await request.formData().catch(() => null)
  if (!form) return jsonError('입력 내용을 확인해주세요.', 400)
  const revision = Number(form.get('revision'))
  if (!Number.isSafeInteger(revision) || revision !== current.revision) return jsonError('지원서가 변경되었습니다. 다시 불러온 뒤 수정해주세요.', 409)
  if (!/^[a-f0-9]{64}$/.test(String(form.get('operationToken') || ''))) return jsonError('수정 요청 정보가 올바르지 않습니다.', 400)
  // The database batch guard belongs to this attempt, never to a replayable client token.
  const operation = genId()
  const name = String(form.get('applicantName') || '').trim().slice(0, 100)
  const phone = String(form.get('applicantPhone') || '').trim().slice(0, 40)
  const optional = parseBool(form.get('consentOptional'))
  if (form.get('consentVersion') !== CONSENT_VERSION) return jsonError('동의 안내가 변경되었습니다. 다시 불러와 확인해주세요.', 409)
  const invalid = validateApplication({ name, email: current.applicant_email, phone, consentRequired: true })
  if (invalid) return jsonError(invalid, 400)
  const career = normalizeCareer(form.get('careerJson'))
  if (!career.ok) return jsonError(career.error, 400)
  const source = String(form.get('applicationSource') || '').trim().slice(0, 200)
  const cover = String(form.get('coverLetter') || '').trim().slice(0, 5000)
  const removePortfolio = parseBool(form.get('removePortfolio'))
  const { results: existing } = await env.DB.prepare(`SELECT id, doc_type FROM application_documents
    WHERE application_id = ? AND superseded_at IS NULL`).bind(params.id).all()
  const files = []
  for (const type of ['resume', 'portfolio']) {
    const file = form.get(type)
    if (!file || typeof file === 'string' || !file.size) continue
    const error = validateUploadFile(file) || await validateFileContent(file)
    if (error) return jsonError(error, 400)
    files.push({ type, file, id: genId(), key: `applications/${params.id}/revisions/${genId()}.${fileExt(file.name)}` })
  }
  if (!existing.some(doc => doc.doc_type === 'resume') && !files.some(file => file.type === 'resume')) return jsonError('이력서를 첨부해주세요.', 400)
  const hasPortfolio = files.some(file => file.type === 'portfolio') || (!removePortfolio && existing.some(doc => doc.doc_type === 'portfolio'))
  if (!optional && (hasPortfolio || career.value || source || cover)) return jsonError('선택 정보를 제거하거나 선택항목 수집에 동의해주세요.', 400)
  const uploaded = []
  const cleanup = async () => {
    for (const file of uploaded) {
      try { await settleApplicationUpload(env, file.key) } catch { console.error('Application replacement cleanup remains queued') }
    }
  }
  try {
    for (const file of files) {
      await stageApplicationUpload(env, file.key)
      uploaded.push(file)
      await env.DOCUMENTS.put(file.key, file.file.stream(), { httpMetadata: { contentType: mimeForExt(fileExt(file.file.name)) } })
    }
  } catch {
    await cleanup()
    return jsonError('첨부파일 업로드에 실패했습니다. 기존 지원서는 유지됩니다.', 502)
  }
  const guard = `EXISTS (SELECT 1 FROM applications WHERE id = ? AND last_edit_operation = ?)`
  const replacements = new Set(files.map(file => file.type))
  if (removePortfolio) replacements.add('portfolio')
  const statements = [env.DB.prepare(`UPDATE applications SET applicant_name = ?, applicant_phone = ?,
    career_json = ?, application_source = ?, cover_letter = ?, consent_optional = ?, consent_version = ?, consent_snapshot = ?,
    consented_at = datetime('now'), revision = revision + 1, last_edit_operation = ?, ai_screening_json = NULL, screened_at = NULL
    WHERE id = ? AND revision = ? AND status = 'submitted' AND withdrawn_at IS NULL AND purged_at IS NULL
      AND EXISTS (SELECT 1 FROM job_postings WHERE id = applications.posting_id AND status = 'open'
        AND (deadline IS NULL OR deadline >= date('now', '+9 hours')))`)
    .bind(name, phone, career.value, source || null, cover || null, optional ? 1 : 0, CONSENT_VERSION, CONSENT_SNAPSHOT, operation, params.id, revision)]
  for (const type of replacements) statements.push(env.DB.prepare(`UPDATE application_documents SET superseded_at = datetime('now')
    WHERE application_id = ? AND doc_type = ? AND superseded_at IS NULL AND ${guard}`).bind(params.id, type, params.id, operation))
  for (const file of files) statements.push(env.DB.prepare(`INSERT INTO application_documents
    (id, application_id, doc_type, filename, r2_key, size_bytes, content_type)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`)
    .bind(file.id, params.id, file.type, file.file.name, file.key, file.file.size, mimeForExt(fileExt(file.file.name)), params.id, operation))
  try {
    const results = await env.DB.batch(statements)
    if (!results[0].meta?.changes) {
      await cleanup()
      return jsonError('지원서가 변경되었거나 심사가 시작되었습니다. 다시 불러와 확인해주세요.', 409)
    }
  } catch {
    // An unresolved transaction can commit after an immediate reference read.
    // Keep staged uploads for delayed retention cleanup in this uncertain case.
    return jsonError('수정 결과를 확인하지 못했습니다. 지원서를 다시 불러와 확인해주세요.', 503)
  }
  await cleanup()
  const reloaded = await requireApplicationAccess(context, params.id)
  return reloaded.error || jsonResponse({ ok: true, application: await applicationSelfView(env, reloaded.application) })
}
