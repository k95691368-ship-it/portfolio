export function maskEmail(email) {
  const [local, domain] = String(email || '').split('@')
  if (!local || !domain) return ''
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}${'*'.repeat(Math.max(1, local.length - visible.length))}@${domain}`
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// 브랜디드 이메일 HTML 템플릿 (최종합격/면접초대 등 공용).
// heading/title 기본값은 최종합격 안내 — 기존 호출부는 그대로 동작.
export function buildBrandedEmailHtml({
  bodyText,
  companyName,
  heading = 'FINAL OFFER',
  title = '최종 합격 안내',
}) {
  const bodyHtml = escapeHtml(bodyText).replace(/\r?\n/g, '<br>')
  const companyHtml = escapeHtml(companyName)
  const headingHtml = escapeHtml(heading)
  const titleHtml = escapeHtml(title)

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${titleHtml}</title>
  </head>
  <body style="margin:0;background:#f5f6f8;font-family:Arial,'Noto Sans KR',sans-serif;color:#20242a;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #e2e5e9;border-radius:12px;padding:32px;">
        <div style="font-size:13px;font-weight:700;color:#3569d4;margin-bottom:18px;">${headingHtml}</div>
        <div style="font-size:16px;line-height:1.75;white-space:normal;">${bodyHtml}</div>
        <div style="margin-top:28px;padding-top:18px;border-top:1px solid #eceef1;color:#68707a;font-size:13px;">
          ${companyHtml} 채용 담당
        </div>
      </div>
    </div>
  </body>
</html>`
}

export function buildFinalOfferEmailHtml({ bodyText, companyName }) {
  return buildBrandedEmailHtml({ bodyText, companyName, heading: 'FINAL OFFER', title: '최종 합격 안내' })
}

// True when the environment has everything needed to actually send mail.
// Used by the route to return a clear "not configured" error instead of
// attempting a doomed send.
//
// 자격 증명이 있다고 발송이 되는 것은 아니다. 공급자 계정이 막혀 있으면 앱은
// "설정됨"으로 믿고 매번 시도하다 실패하고, 그 실패가 합격 처리·계약서 저장
// 화면에 "전송 실패"로 새어 나오며 교부 이력에도 실패 행을 남긴다. 미구현인데
// 구현된 척하다 넘어지는 것이 가장 나쁘다.
//
// 그래서 명시적으로 켜야 켜진다. EMAIL_ENABLED가 '1'이 아니면 앱 전체가 이
// 기능을 아직 만들지 않은 것으로 취급하고, 화면은 그렇게 안내한다.
// 발송을 되살릴 때는 자격 증명과 함께 EMAIL_ENABLED=1을 넣으면 된다.
export function isEmailConfigured(env) {
  if (env.EMAIL_ENABLED !== '1') return false
  return !!(env.MAILJET_API_KEY && env.MAILJET_SECRET_KEY && env.FINAL_OFFER_FROM_EMAIL)
}

// 공용 발송 함수 — 모든 이메일이 이 함수를 통해 Mailjet(v3.1)으로 발송된다.
// attachments: [{ filename, contentBase64, contentType }] (선택)
export async function sendBrandedEmail(
  env,
  { to, subject, bodyText, companyName, heading, title, attachments }
) {
  if (!env.MAILJET_API_KEY || !env.MAILJET_SECRET_KEY) {
    throw new Error('MAILJET_API_KEY / MAILJET_SECRET_KEY 환경 변수가 설정되지 않았습니다.')
  }
  if (!env.FINAL_OFFER_FROM_EMAIL) {
    throw new Error('FINAL_OFFER_FROM_EMAIL 환경 변수가 설정되지 않았습니다.')
  }

  const fromName = env.FINAL_OFFER_FROM_NAME || companyName || ''
  const message = {
    From: { Email: env.FINAL_OFFER_FROM_EMAIL, Name: fromName },
    To: [{ Email: to }],
    Subject: subject,
    TextPart: bodyText,
    HTMLPart: buildBrandedEmailHtml({ bodyText, companyName, heading, title }),
  }
  if (Array.isArray(attachments) && attachments.length > 0) {
    message.Attachments = attachments.map((a) => ({
      ContentType: a.contentType || 'application/octet-stream',
      Filename: a.filename,
      Base64Content: a.contentBase64,
    }))
  }

  const auth = btoa(`${env.MAILJET_API_KEY}:${env.MAILJET_SECRET_KEY}`)
  const res = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ Messages: [message] }),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Mailjet API 오류 (${res.status}): ${detail.slice(0, 300)}`)
  }

  const result = await res.json()
  const status = result?.Messages?.[0]?.Status
  if (status !== 'success') {
    throw new Error(`Mailjet 발송 실패: ${JSON.stringify(result?.Messages?.[0] ?? result).slice(0, 300)}`)
  }
  return result
}

export async function sendFinalOfferEmail(env, { to, subject, bodyText, companyName }) {
  return sendBrandedEmail(env, {
    to,
    subject,
    bodyText,
    companyName,
    heading: 'FINAL OFFER',
    title: '최종 합격 안내',
  })
}

export async function sendRoomInviteEmail(env, { to, subject, bodyText, companyName }) {
  return sendBrandedEmail(env, {
    to,
    subject,
    bodyText,
    companyName,
    heading: 'INTERVIEW INVITE',
    title: '면접방 참여 안내',
  })
}

// 서류 전형 결과(합격/불합격)를 지원자에게 안내.
export async function sendApplicationResultEmail(env, { to, applicantName, companyName, result }) {
  const passed = result === 'passed'
  const subject = passed
    ? `[${companyName}] 서류 전형 합격 안내`
    : `[${companyName}] 서류 전형 결과 안내`
  const bodyText = passed
    ? `안녕하세요, ${applicantName}님.

${companyName} 서류 전형에 합격하셨음을 안내드립니다.
지원하신 이메일이 로그인 아이디가 되며, 담당자가 별도로 안내하는 임시 비밀번호로 로그인하신 뒤 면접 절차를 이어서 진행해 주세요.

축하드립니다. 감사합니다.`
    : `안녕하세요, ${applicantName}님.

${companyName} 서류 전형에 지원해 주셔서 진심으로 감사드립니다.
아쉽게도 이번 전형에서는 함께하지 못하게 되었음을 안내드립니다.
지원자님의 앞날에 좋은 결과가 있기를 응원하겠습니다.

감사합니다.`

  return sendBrandedEmail(env, {
    to,
    subject,
    bodyText,
    companyName,
    heading: passed ? 'DOCUMENT PASS' : 'RESULT',
    title: passed ? '서류 전형 합격 안내' : '서류 전형 결과 안내',
  })
}

// 서명 완료된 근로계약서 PDF를 첨부하여 지원자에게 발송.
// pdfBase64 는 PDF 바이트의 base64 문자열.
export async function sendSignedContractEmail(env, { to, companyName, pdfBase64, filename }) {
  const bodyText = `안녕하세요.

${companyName}와(과) 체결한 근로계약서 서명본을 첨부합니다. 내용을 확인하시고 보관해 주세요.

감사합니다.`

  return sendBrandedEmail(env, {
    to,
    subject: `[${companyName}] 근로계약서 사본 전달`,
    bodyText,
    companyName,
    heading: 'LABOR CONTRACT',
    title: '근로계약서 사본',
    attachments: [
      { filename: filename || '근로계약서.pdf', contentBase64: pdfBase64, contentType: 'application/pdf' },
    ],
  })
}

// ArrayBuffer → base64 (큰 파일에서 스택 오버플로를 피하기 위해 청크 처리).
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
