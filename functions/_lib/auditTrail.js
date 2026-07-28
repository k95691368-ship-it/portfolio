// 감사추적 이벤트 조립 (조회는 호출부에서, 여기서는 가공만).
// 단독 엔드포인트와 계약서 페이지 통합 조회가 같은 로직을 공유한다.

// SQLite "YYYY-MM-DD HH:MM:SS"와 ISO "....T...Z"가 섞여 있어 정렬용으로 통일한다.
export function normalizeTime(t) {
  if (!t) return ''
  return String(t).replace('T', ' ').replace('Z', '').slice(0, 19)
}

// 원시 User-Agent는 사람이 읽을 수 없으므로 브라우저·운영체제만 뽑는다.
export function summarizeUserAgent(ua) {
  if (!ua) return null
  const s = String(ua)
  const browser =
    (/Edg\//.test(s) && 'Edge') ||
    (/OPR\//.test(s) && 'Opera') ||
    (/Chrome\//.test(s) && 'Chrome') ||
    (/Safari\//.test(s) && !/Chrome\//.test(s) && 'Safari') ||
    (/Firefox\//.test(s) && 'Firefox') ||
    null
  const os =
    (/Windows NT/.test(s) && 'Windows') ||
    (/iPhone|iPad/.test(s) && 'iOS') ||
    (/Android/.test(s) && 'Android') ||
    (/Mac OS X/.test(s) && 'macOS') ||
    (/Linux/.test(s) && 'Linux') ||
    null
  const parts = [browser, os].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

// 서명이 이루어진 접속 환경을 한 줄로 정리한다.
export function describeSigningEnvironment(sig) {
  const parts = []
  if (sig.signer_ip) parts.push(`IP ${sig.signer_ip}`)
  const device = summarizeUserAgent(sig.signer_user_agent)
  if (device) parts.push(device)
  if (sig.signer_country) parts.push(sig.signer_country)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function buildAuditEvents({
  room,
  participants,
  terms,
  history,
  signatures,
  signedContract,
  finalOffer,
}) {
  const events = []
  events.push({ at: room.created_at, event: '면접방 생성', detail: room.title })

  for (const p of participants) {
    events.push({
      at: p.joined_at,
      event: p.role_in_room === 'company' ? '회사 참여' : '지원자 참여',
      detail: p.display_name,
    })
  }
  if (terms?.last_analyzed_at) {
    events.push({ at: terms.last_analyzed_at, event: 'AI 조건 분석 (최근)', detail: null })
  }
  if (terms?.hire_confirmed_at) {
    events.push({ at: terms.hire_confirmed_at, event: '채용 확정', detail: null })
  }
  for (const h of history) {
    let count = 0
    try {
      count = JSON.parse(h.changes).length
    } catch {
      count = 0
    }
    events.push({
      at: h.created_at,
      event: '계약 조건 수정',
      detail: `${h.display_name} · ${count}개 항목`,
    })
  }
  for (const s of signatures) {
    const environment = describeSigningEnvironment(s)
    events.push({
      at: s.signed_at,
      event: s.signer_role === 'company' ? '회사 서명' : '지원자 서명',
      detail: environment ? `${s.display_name} · ${environment}` : s.display_name,
    })
  }
  if (finalOffer?.sent_at) {
    events.push({ at: finalOffer.sent_at, event: '최종합격 이메일 발송', detail: null })
  }
  if (signedContract) {
    events.push({
      at: signedContract.created_at,
      event: '서명 계약서 보관',
      detail: signedContract.filename,
    })
    if (signedContract.emailed_at) {
      events.push({ at: signedContract.emailed_at, event: '계약서 사본 이메일 발송', detail: null })
    }
  }

  events.sort((a, b) => normalizeTime(a.at).localeCompare(normalizeTime(b.at)))
  return events.map((e) => ({ ...e, at: normalizeTime(e.at) }))
}
