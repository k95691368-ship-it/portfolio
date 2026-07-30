import { genId } from '../../../_lib/db.js'
import { jsonResponse, jsonError } from '../../../_lib/http.js'
import { checkRateLimit, releaseRateLimit } from '../../../_lib/rateLimit.js'
import { parseBool, validateApplication, normalizeCareer } from '../../../_lib/application.js'
import { fileExt, mimeForExt, validateUploadFile, validateFileContent } from '../../../_lib/uploads.js'

const NAME_MAX = 100
const PHONE_MAX = 40
const SOURCE_MAX = 200
const COVER_MAX = 5000

// 지원 현황 조회용 접수번호 (혼동 문자 제외 10자)
function genLookupCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  let code = ''
  for (const b of bytes) code += alphabet[b % alphabet.length]
  return code
}

// 공개: 특정 채용 공고에 지원. 로그인 불필요, multipart(파일 포함) 한 번의 요청.
export async function onRequestPost({ request, env, params }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const bucket = `apply:${ip}`
  const ticket = await checkRateLimit(env, bucket, 5, 3600)
  if (!ticket) return jsonError('지원이 너무 많습니다. 잠시 후 다시 시도해주세요.', 429)

  // 끝내 제출되지 못한 요청은 한도를 소모하지 않는다. 이력서 형식을 잘못 고른
  // 사람이 고쳐서 다시 내려 할 때 막히면, 그건 막으려던 남용이 아니라
  // 그냥 지원 실패다.
  const fail = async (message, status) => {
    await releaseRateLimit(env, bucket, ticket)
    return jsonError(message, status)
  }

  const posting = await env.DB.prepare(
    `SELECT id, title, status,
            (deadline IS NOT NULL AND deadline < date('now')) AS expired
     FROM job_postings WHERE id = ?`
  )
    .bind(params.id)
    .first()
  if (!posting || posting.status !== 'open' || posting.expired) {
    return fail('마감되었거나 존재하지 않는 채용 공고입니다.', 404)
  }

  const form = await request.formData().catch(() => null)
  if (!form) return fail('잘못된 요청입니다.', 400)

  const name = (form.get('applicantName') || '').toString().trim().slice(0, NAME_MAX)
  const email = (form.get('applicantEmail') || '').toString().trim().toLowerCase()
  const phone = (form.get('applicantPhone') || '').toString().trim().slice(0, PHONE_MAX)
  const source = (form.get('applicationSource') || '').toString().trim().slice(0, SOURCE_MAX)
  const coverLetter = (form.get('coverLetter') || '').toString().trim().slice(0, COVER_MAX)
  const consentRequired = parseBool(form.get('consentRequired'))
  const consentOptional = parseBool(form.get('consentOptional'))
  const consentThirdParty = parseBool(form.get('consentThirdParty'))

  const validationError = validateApplication({ name, email, phone, consentRequired })
  if (validationError) return fail(validationError, 400)

  const career = normalizeCareer(form.get('careerJson'))
  if (!career.ok) return fail(career.error, 400)

  // 파일: 이력서 필수, 포트폴리오 선택
  const resumeFile = form.get('resume')
  const resumeError = validateUploadFile(resumeFile)
  if (resumeError) return fail(`이력서: ${resumeError}`, 400)
  const resumeContentError = await validateFileContent(resumeFile)
  if (resumeContentError) return fail(`이력서: ${resumeContentError}`, 400)

  const portfolioFile = form.get('portfolio')
  const hasPortfolio = portfolioFile && typeof portfolioFile !== 'string' && portfolioFile.size > 0
  if (hasPortfolio) {
    const portfolioError = validateUploadFile(portfolioFile)
    if (portfolioError) return fail(`포트폴리오: ${portfolioError}`, 400)
    const portfolioContentError = await validateFileContent(portfolioFile)
    if (portfolioContentError) return fail(`포트폴리오: ${portfolioContentError}`, 400)
  }

  // 같은 공고에 같은 이메일로 심사 대기 중인 지원이 있으면 중복 차단
  const dup = await env.DB.prepare(
    `SELECT id FROM applications
     WHERE posting_id = ? AND applicant_email = ? AND status = 'submitted'`
  )
    .bind(params.id, email)
    .first()
  if (dup) return fail('이미 이 공고에 지원하셨습니다. 심사 결과를 기다려주세요.', 409)

  const appId = genId()

  // R2 업로드를 먼저 수행 — 실패 시 DB에 아무것도 남지 않도록.
  const uploads = []
  const filesToStore = [{ file: resumeFile, docType: 'resume' }]
  if (hasPortfolio) filesToStore.push({ file: portfolioFile, docType: 'portfolio' })

  try {
    for (const { file, docType } of filesToStore) {
      const ext = fileExt(file.name)
      const contentType = mimeForExt(ext)
      const r2Key = `applications/${appId}/${docType}-${Date.now()}.${ext}`
      await env.DOCUMENTS.put(r2Key, file.stream(), { httpMetadata: { contentType } })
      uploads.push({
        id: genId(),
        docType,
        filename: file.name,
        r2Key,
        size: file.size,
        contentType,
      })
    }
  } catch (err) {
    console.error(`Application upload failed (posting ${params.id}):`, err)
    // 이미 올라간 파일 정리 시도
    await Promise.allSettled(uploads.map((u) => env.DOCUMENTS.delete(u.r2Key)))
    return fail('파일 업로드에 실패했습니다. 잠시 후 다시 시도해주세요.', 502)
  }

  const lookupCode = genLookupCode()
  const statements = [
    env.DB.prepare(
      `INSERT INTO applications (
         id, posting_id, applicant_name, applicant_email, applicant_phone,
         career_json, application_source, cover_letter,
         consent_required, consent_optional, consent_third_party, consented_at, lookup_code
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
    ).bind(
      appId,
      params.id,
      name,
      email,
      phone,
      career.value,
      source || null,
      coverLetter || null,
      consentRequired ? 1 : 0,
      consentOptional ? 1 : 0,
      consentThirdParty ? 1 : 0,
      lookupCode
    ),
    ...uploads.map((u) =>
      env.DB.prepare(
        `INSERT INTO application_documents (id, application_id, doc_type, filename, r2_key, size_bytes, content_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(u.id, appId, u.docType, u.filename, u.r2Key, u.size, u.contentType)
    ),
  ]

  try {
    await env.DB.batch(statements)
  } catch (err) {
    console.error(`Application insert failed (posting ${params.id}):`, err)
    await Promise.allSettled(uploads.map((u) => env.DOCUMENTS.delete(u.r2Key)))
    // 동시 제출 경쟁으로 부분 유니크 인덱스를 위반한 경우 중복 안내로 응답
    if (String(err?.message || err).includes('UNIQUE')) {
      return fail('이미 이 공고에 지원하셨습니다. 심사 결과를 기다려주세요.', 409)
    }
    return fail('지원서 저장에 실패했습니다. 잠시 후 다시 시도해주세요.', 500)
  }

  return jsonResponse({ ok: true, applicationId: appId, lookupCode }, 201)
}
