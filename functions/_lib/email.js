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

export function buildFinalOfferEmailHtml({ bodyText, companyName }) {
  const bodyHtml = escapeHtml(bodyText).replace(/\r?\n/g, '<br>')
  const companyHtml = escapeHtml(companyName)

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>최종 합격 안내</title>
  </head>
  <body style="margin:0;background:#f5f6f8;font-family:Arial,'Noto Sans KR',sans-serif;color:#20242a;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #e2e5e9;border-radius:12px;padding:32px;">
        <div style="font-size:13px;font-weight:700;color:#3569d4;margin-bottom:18px;">FINAL OFFER</div>
        <div style="font-size:16px;line-height:1.75;white-space:normal;">${bodyHtml}</div>
        <div style="margin-top:28px;padding-top:18px;border-top:1px solid #eceef1;color:#68707a;font-size:13px;">
          ${companyHtml} 채용 담당
        </div>
      </div>
    </div>
  </body>
</html>`
}

// True when the environment has everything needed to actually send mail.
// Used by the route to return a clear "not configured" error instead of
// attempting a doomed send.
export function isEmailConfigured(env) {
  return !!(env.RESEND_API_KEY && env.FINAL_OFFER_FROM_EMAIL)
}

export async function sendFinalOfferEmail(env, { to, subject, bodyText, companyName }) {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY 환경 변수가 설정되지 않았습니다.')
  }
  if (!env.FINAL_OFFER_FROM_EMAIL) {
    throw new Error('FINAL_OFFER_FROM_EMAIL 환경 변수가 설정되지 않았습니다.')
  }

  const fromName = env.FINAL_OFFER_FROM_NAME || companyName
  const from = fromName ? `${fromName} <${env.FINAL_OFFER_FROM_EMAIL}>` : env.FINAL_OFFER_FROM_EMAIL

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text: bodyText,
      html: buildFinalOfferEmailHtml({ bodyText, companyName }),
    }),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Resend API 오류 (${res.status}): ${detail.slice(0, 300)}`)
  }

  return res.json()
}
