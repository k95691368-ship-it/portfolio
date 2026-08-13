// 감사추적증명서 (순수 함수 — 단위 테스트 대상).
//
// 지금까지 이 앱이 내보내는 유일한 문서는 계약서 화면을 이미지로 찍어 만든
// PDF였고, 그 이미지 바이트의 해시를 "문서 무결성 지문"으로 보여 주었다.
// 래스터 바이트는 기기 픽셀 비율·폰트 대체에 따라 달라지므로 재현할 수 없다.
// 재현할 수 없는 지문은 무결성을 증명하지 못한다. 반대로 재현 가능한 정본 지문
// (서명 시점에 계산해 signatures.document_sha256에 넣은 값)은 아무 데로도
// 내보내지지 않고 있었다.
//
// 증명서는 그 격을 뒤집는다. 정본 지문을 앞세우고, PDF 바이트 해시는 "회사가
// 보관한 사본의 해시(사본마다 달라질 수 있음)"로 낮춰 표기한다.

const CERT_VERSION = 'AC-1'

// 발급번호에 쓰는 글자 — 혼동되는 0/O/1/I/L 제외
const SERIAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function formatSerial(bytes) {
  const chars = Array.from(bytes || [], (b) => SERIAL_ALPHABET[b % SERIAL_ALPHABET.length])
  while (chars.length < 12) chars.push(SERIAL_ALPHABET[0])
  const body = chars.slice(0, 12).join('')
  return `AC-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`
}

// 사람이 옮겨 적은 발급번호를 받아들인다 — 소문자·공백·하이픈 누락을 모두 허용.
export function parseSerial(text) {
  const cleaned = String(text ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  const body = cleaned.startsWith('AC') ? cleaned.slice(2) : cleaned
  if (body.length !== 12) return null
  if (!/^[A-Z0-9]{12}$/.test(body)) return null
  return `AC-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`
}

// 서명에 쓰인 본인확인 수단. 없는 근거를 있는 것처럼 부르지 않는다.
const VERIFICATION_LABELS = {
  account_password: '계정 비밀번호로 인증된 세션',
  temp_password: '임시 비밀번호로 인증된 세션',
  // 코드는 회사 담당자도 볼 수 있는 값이다. 그 세션에서 나온 서명을 비밀번호
  // 확인이라고 부르면 증명서가 거짓이 된다. 무엇으로 들어왔는지 그대로 적어,
  // 다투는 자리에서 두 가지가 구분되게 한다.
  invite_code: '면접방 입장 코드로 인증된 세션 (계정 비밀번호 확인 없음)',
}

// 이 세션은 무엇으로 본인을 확인했는가.
//
// 세션에 적힌 로그인 수단이 먼저다. 코드로 들어왔는데 임시 비밀번호를 아직
// 바꾸지 않은 계정이라고 해서 '임시 비밀번호로 확인'이라고 적으면, 실제로는
// 아무도 확인하지 않은 것을 확인했다고 적는 셈이다.
export function signerVerificationMethod(user) {
  if (user?.session_auth_method === 'invite_code') return 'invite_code'
  return user?.must_change_password ? 'temp_password' : 'account_password'
}

export function describeVerificationMethod(signature) {
  const code = signature?.verification_method ?? signature?.verificationMethod ?? null
  if (!code) {
    return {
      code: 'unrecorded',
      label: '기록 없음 (도입 전 서명)',
      recorded: false,
      detail: null,
    }
  }
  const email = signature?.verified_email ?? signature?.verifiedEmail ?? null
  const startedAt = signature?.session_started_at ?? signature?.sessionStartedAt ?? null
  return {
    code,
    label: VERIFICATION_LABELS[code] || code,
    recorded: true,
    detail: [email ? `계정 ${maskEmailLocal(email)}` : null, startedAt ? `로그인 ${startedAt}` : null]
      .filter(Boolean)
      .join(' · '),
  }
}

function maskEmailLocal(email) {
  const s = String(email || '')
  const at = s.indexOf('@')
  if (at <= 1) return s
  return `${s.slice(0, 2)}${'*'.repeat(Math.max(1, at - 2))}${s.slice(at)}`
}

export function maskName(name) {
  const s = String(name || '')
  if (s.length <= 1) return s
  return s[0] + '*'.repeat(s.length - 1)
}

// 서명들이 어떤 문서에 붙어 있는지, 지금 내용과 같은지 정리한다.
export function resolveDocumentIdentity({ signatures, storedPdfSha256, currentSha256 } = {}) {
  const list = signatures || []
  const perSigner = list.map((s) => ({
    role: s.signer_role ?? s.role,
    signedAt: s.signed_at ?? s.signedAt ?? null,
    documentSha256: s.document_sha256 ?? s.documentSha256 ?? null,
  }))

  const hashes = perSigner.map((p) => p.documentSha256).filter(Boolean)
  const allSignersMatch = hashes.length > 0 && hashes.every((h) => h === hashes[0])
  const signedSha256 = allSignersMatch ? hashes[0] : null
  const unchangedSinceSigning = Boolean(signedSha256 && currentSha256 && signedSha256 === currentSha256)

  const concerns = []
  if (list.length > 0 && hashes.length < list.length) {
    concerns.push('일부 서명에 문서 지문이 기록되어 있지 않습니다 (지문 도입 전 서명).')
  }
  if (hashes.length > 1 && !allSignersMatch) {
    concerns.push('서명자마다 서로 다른 문서에 서명한 기록이 있습니다.')
  }
  if (signedSha256 && currentSha256 && !unchangedSinceSigning) {
    concerns.push('서명 이후 계약 내용이 달라졌습니다.')
  }

  let statement
  if (!signedSha256) statement = '서명 대상 문서의 지문을 확인할 수 없습니다.'
  else if (unchangedSinceSigning) statement = '양측이 서명한 문서가 현재 계약 내용과 같습니다.'
  else statement = '서명 당시 문서와 현재 계약 내용이 다릅니다.'

  return {
    perSigner,
    signedSha256,
    currentSha256: currentSha256 ?? null,
    allSignersMatch,
    unchangedSinceSigning,
    // 회사가 올린 PDF 바이트 해시. 사본마다 달라질 수 있어 정본 지문보다 아래에 둔다.
    storedPdfSha256: storedPdfSha256 ?? null,
    storedPdfAvailable: Boolean(storedPdfSha256),
    statement,
    concerns,
  }
}

// 증명서 본문을 만든다. 발급 시점의 사실을 그대로 동결한다.
export function buildCertificate(input) {
  const {
    serial,
    issuedAt,
    issuedByName,
    room,
    participants,
    signatures,
    revokedSignatures,
    deliveries,
    deliveryState,
    events,
    document,
    period,
    retention,
  } = input || {}

  return {
    version: CERT_VERSION,
    serial: serial ?? null,
    issuedAt: issuedAt ?? null,
    issuedBy: issuedByName ?? null,
    room: {
      id: room?.id ?? null,
      title: room?.title ?? null,
      status: room?.status ?? null,
    },
    parties: (participants || []).map((p) => ({
      role: p.role_in_room ?? p.role,
      // 증명서는 제3자에게 보일 수 있으므로 이름을 가린다.
      name: maskName(p.display_name ?? p.displayName),
      companyName: p.company_name ?? p.companyName ?? null,
    })),
    signatures: (signatures || []).map((s) => {
      const v = describeVerificationMethod(s)
      return {
        role: s.signer_role ?? s.role,
        signedAt: s.signed_at ?? s.signedAt ?? null,
        documentSha256: s.document_sha256 ?? s.documentSha256 ?? null,
        environment: s.environment ?? null,
        verification: { code: v.code, label: v.label, detail: v.detail },
      }
    }),
    revokedSignatures: (revokedSignatures || []).map((r) => ({
      role: r.signer_role ?? r.role,
      signedAt: r.signed_at ?? r.signedAt ?? null,
      revokedAt: r.revoked_at ?? r.revokedAt ?? null,
      reason: r.reason ?? null,
      documentSha256: r.document_sha256 ?? r.documentSha256 ?? null,
    })),
    deliveries: (deliveries || []).map((d) => ({
      channel: d.channel,
      status: d.status,
      deliveredAt: d.deliveredAt ?? d.delivered_at ?? null,
      firstViewedAt: d.firstViewedAt ?? d.first_viewed_at ?? null,
      downloadedAt: d.downloadedAt ?? d.downloaded_at ?? null,
    })),
    deliveryState: deliveryState ? { label: deliveryState.label, delivered: deliveryState.delivered } : null,
    events: (events || []).map((e) => ({ at: e.at, event: e.event, detail: e.detail ?? null })),
    document: document ?? null,
    period: period ? { startDate: period.startDate, endDate: period.endDate, label: period.label } : null,
    retention: retention?.known
      ? {
          basis: retention.basis,
          basisType: retention.basisType,
          started: retention.started,
          until: retention.until,
        }
      : null,
    notice:
      '이 증명서는 발급 시점의 기록을 그대로 담은 것입니다. 아래 정본 문자열을 SHA-256으로 해시하면 증명서 지문과 같아야 합니다. 이 검증은 발급 기록과 증명서 지문의 일치를 확인하며, 발급 시스템 자체를 신뢰할 수 없는 상황까지 증명하지는 않습니다.',
  }
}

// 증명서를 한 가지 문자열로 만든다.
//
// 손으로 쓴 섹션 목록이 아니라 일반 직렬화기로 만든 이유: 나중에 항목이 늘어도
// 기존 부분의 출력이 그대로 남아야, 옛 증명서가 변조로 뒤집히지 않는다.
// 객체는 키 사전순, 배열은 주어진 순서를 지킨다.
export function canonicalizeCertificate(cert) {
  const lines = [`version=${CERT_VERSION}`]

  const walk = (value, path) => {
    if (value === null || value === undefined) {
      lines.push(`${path}=`)
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`))
      return
    }
    if (typeof value === 'object') {
      for (const key of Object.keys(value).sort()) {
        walk(value[key], path ? `${path}.${key}` : key)
      }
      return
    }
    lines.push(`${path}=${String(value)}`)
  }

  for (const key of Object.keys(cert || {}).sort()) {
    if (key === 'version') continue
    walk(cert[key], key)
  }
  return lines.join('\n')
}

export async function certificateFingerprint(certOrText) {
  const text = typeof certOrText === 'string' ? certOrText : canonicalizeCertificate(certOrText)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// 검증 결과를 사람이 읽을 문장으로.
export function verifyCertificate({ storedSha256, recomputedSha256, providedSha256, revokedAt } = {}) {
  const tampered = Boolean(storedSha256 && recomputedSha256 && storedSha256 !== recomputedSha256)
  const revoked = Boolean(revokedAt)
  const matchesProvided = providedSha256 ? providedSha256 === storedSha256 : null

  if (tampered) {
    return {
      valid: false,
      tampered: true,
      matchesProvided,
      label: '보관된 기록이 변조되었습니다',
      detail: '발급 시 동결한 원본과 지문이 일치하지 않습니다. 발급 기관에 문의하세요.',
    }
  }
  if (revoked) {
    return {
      valid: false,
      tampered: false,
      matchesProvided,
      label: '취소된 증명서입니다',
      detail: `${revokedAt}에 취소되었습니다.`,
    }
  }
  if (matchesProvided === false) {
    return {
      valid: false,
      tampered: false,
      matchesProvided: false,
      label: '제시한 지문이 다릅니다',
      detail: '발급 기록은 정상이지만, 확인하려는 문서의 지문이 발급된 증명서와 다릅니다.',
    }
  }
  return {
    valid: true,
    tampered: false,
    matchesProvided,
    label: '유효한 증명서입니다',
    detail: '발급 기록과 증명서 지문이 일치합니다.',
  }
}
