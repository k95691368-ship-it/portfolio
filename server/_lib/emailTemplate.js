// Email-safe table layout and inline styles. No remote images, fonts or tracking.
const PLATFORM_ORIGIN = 'https://portfolio-epa.pages.dev'
const ACTIONS = {
  room: { path: '/jobs', label: '면접방 입장 코드 입력' },
  status: { path: '/application-status', label: '지원 현황 확인' },
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

export function buildBrandedEmailHtml({ bodyText, companyName, title, details = [], action }) {
  const company = companyName || '채용 담당자'
  const titleHtml = escapeHtml(title)
  const rows = [['회사', companyName], ...details]
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => `<tr>
      <th scope="row" width="30%" align="left" valign="top" bgcolor="#f2f4f7" style="width:30%;padding:16px;border-bottom:1px solid #dce1e8;background-color:#f2f4f7;color:#505966;font-size:14px;font-weight:500;line-height:1.6;word-break:keep-all;word-wrap:break-word;overflow-wrap:anywhere;">${escapeHtml(label)}</th>
      <td valign="top" style="padding:16px;border-bottom:1px solid #dce1e8;color:#182231;font-size:15px;font-weight:600;line-height:1.6;word-break:keep-all;word-wrap:break-word;overflow-wrap:anywhere;">${escapeHtml(value)}</td>
    </tr>`).join('')
  const cta = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null
  const url = cta ? `${PLATFORM_ORIGIN}${cta.path}` : ''

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${titleHtml}</title>
  <style>
    @media screen and (max-width:480px) {
      .email-outer { padding:16px 8px !important; }
      .email-content { padding:24px 20px !important; }
      .email-title { font-size:26px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#eef1f5;color:#182231;font-family:'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef1f5" style="width:100%;border-collapse:collapse;background-color:#eef1f5;">
    <tr><td class="email-outer" align="center" style="padding:40px 16px;">
      <!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:640px;table-layout:fixed;border-collapse:collapse;background-color:#ffffff;">
        <tr><td class="email-content" bgcolor="#0d1b35" style="padding:32px;background-color:#0d1b35;border-top:4px solid #a0c8f0;">
          <p style="margin:0 0 28px;color:#a0c8f0;font-size:13px;font-weight:600;letter-spacing:1px;">통합 채용 플랫폼</p>
          <h1 class="email-title" style="margin:0;color:#ffffff;font-size:30px;font-weight:700;line-height:1.4;word-wrap:break-word;">${titleHtml}</h1>
          <p style="margin:12px 0 0;color:#c6d2e3;font-size:15px;line-height:1.6;word-break:keep-all;overflow-wrap:anywhere;word-wrap:break-word;">${escapeHtml(company)}</p>
        </td></tr>
        <tr><td class="email-content" style="padding:32px;">
          ${rows ? `<table aria-label="${titleHtml} 상세 정보" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;border-top:2px solid #182231;">${rows}</table>` : ''}
          <div style="margin-top:28px;color:#303b49;font-size:16px;line-height:1.85;word-break:keep-all;word-wrap:break-word;overflow-wrap:anywhere;">${escapeHtml(bodyText).replace(/\r\n|\r|\n/g, '<br>')}</div>
          ${cta ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;border-collapse:collapse;">
            <tr><td align="center" bgcolor="#0d1b35" style="background-color:#0d1b35;border-radius:6px;mso-padding-alt:14px 24px;">
              <a href="${url}" style="display:inline-block;padding:14px 24px;border:1px solid #0d1b35;border-radius:6px;color:#ffffff;font-size:15px;font-weight:600;line-height:22px;text-align:center;text-decoration:none;">${cta.label}</a>
            </td></tr>
          </table>
          <p style="margin:16px 0 0;color:#687384;font-size:12px;line-height:1.7;word-break:break-all;">버튼이 열리지 않으면 아래 주소를 이용하세요.<br><a href="${url}" style="color:#385f8a;text-decoration:underline;">${url}</a></p>` : ''}
        </td></tr>
        <tr><td class="email-content" style="padding:24px 32px;border-top:1px solid #dce1e8;color:#687384;font-size:12px;line-height:1.7;word-wrap:break-word;">
          ${escapeHtml(companyName ? `${companyName} 채용 담당` : '채용 담당자')}<br>
          <a href="${PLATFORM_ORIGIN}" style="color:#385f8a;text-decoration:none;">통합 채용 플랫폼</a>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`
}
