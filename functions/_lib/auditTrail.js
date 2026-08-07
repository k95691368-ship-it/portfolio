// 감사추적 이벤트 조립 (조회는 호출부에서, 여기서는 가공만).
// 단독 엔드포인트와 계약서 페이지 통합 조회가 같은 로직을 공유한다.

// SQLite "YYYY-MM-DD HH:MM:SS"와 ISO "....T...Z"가 섞여 있어 정렬용으로 통일한다.
function normalizeTime(t) {
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

function roleLabel(role) {
  return role === 'company' ? '회사' : role === 'candidate' ? '지원자' : String(role ?? '')
}

// 계약에 실제로 일어난 일과 감사추적에 담기는 일이 어긋나 있었다.
//
// 서명이 무효가 되고, 근로자가 조건 수정을 요청하고, 회사가 그것을 반려하고,
// 계약서가 교부되고, 근로자가 그것을 열어 보고, 외국어본이 만들어지고, 증명서가
// 발급되는 — 이 모든 사건이 각자의 표에는 남아 있는데 타임라인에는 없었다.
// 그래서 증명서의 이력이 실제보다 성기게 나왔다. 이력을 증명한다면서 이력의
// 절반을 빠뜨리는 문서였다.
//
// 다만 값은 담지 않는다. 증명서는 계약 당사자가 아닌 사람에게 제시되므로,
// "임금을 얼마에서 얼마로 바꿔달라고 했다"가 들어가면 발급번호를 아는 것만으로
// 남의 근로조건이 보인다. 무엇에 대한 사건인지(항목 이름)까지만 남긴다.
export function buildAuditEvents({
  room,
  participants,
  terms,
  history,
  signatures,
  signedContract,
  finalOffer,
  revocations,
  changeRequests,
  deliveries,
  translations,
  certificates,
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
  // 서명 후 내용이 바뀌면 그 서명은 무효가 된다. 왜 다시 서명해야 했는지가
  // 이력에 없으면 "서명이 두 번 있는 이상한 계약"으로만 보인다.
  for (const r of revocations || []) {
    events.push({
      at: r.revoked_at ?? r.revokedAt,
      event: `${roleLabel(r.signer_role ?? r.role)} 서명 무효화`,
      detail: r.reason ?? null,
    })
  }

  // 수정 요청과 그 회신. 값은 넣지 않는다 (위 주석 참고).
  for (const c of changeRequests || []) {
    const label = c.label ?? c.field ?? null
    events.push({
      at: c.createdAt ?? c.created_at,
      event: '계약 조건 수정 요청',
      detail: label,
    })
    const resolvedAt = c.resolvedAt ?? c.resolved_at
    if (resolvedAt) {
      events.push({
        at: resolvedAt,
        event: c.status === 'accepted' ? '수정 요청 수락' : '수정 요청 반려',
        detail: label,
      })
    }
  }

  // 교부와 그것이 실제로 근로자에게 닿은 시점 (제17조 제2항 · 전자문서법 제5조).
  for (const d of deliveries || []) {
    const deliveredAt = d.deliveredAt ?? d.delivered_at
    const channel = d.channelLabel ?? d.channel
    if (deliveredAt) {
      events.push({
        at: deliveredAt,
        event: d.status === 'failed' ? '계약서 교부 실패' : '계약서 교부',
        detail: channel,
      })
    }
    const firstViewedAt = d.firstViewedAt ?? d.first_viewed_at
    if (firstViewedAt) {
      events.push({ at: firstViewedAt, event: '근로자 계약서 열람', detail: channel })
    }
    const downloadedAt = d.downloadedAt ?? d.downloaded_at
    if (downloadedAt) {
      events.push({ at: downloadedAt, event: '근로자 계약서 내려받음', detail: channel })
    }
  }

  // 외국인 근로자가 무엇을 읽고 서명했는지는 이력의 일부다.
  for (const t of translations || []) {
    events.push({
      at: t.createdAt ?? t.created_at,
      event: '외국어 계약서 생성',
      detail: t.nativeLabel ?? t.label ?? t.language ?? null,
    })
  }

  // 이미 발급된 증명서. 같은 계약에 대해 몇 장이 나가 있는지 드러난다.
  for (const c of certificates || []) {
    events.push({
      at: c.issuedAt ?? c.issued_at,
      event: '감사추적증명서 발급',
      detail: c.serial ?? null,
    })
  }

  // 근로관계가 끝난 날은 보존 기간(제42조)의 기산일이다. 이력에 남지 않으면
  // 나중에 "언제부터 3년인가"를 증명서로 답할 수 없다.
  if (terms?.employment_ended_at) {
    events.push({
      at: terms.employment_end_recorded_at || terms.employment_ended_at,
      event: '근로관계 종료 기록',
      detail: [
        `종료일 ${terms.employment_ended_at}`,
        terms.employment_end_reason || null,
      ]
        .filter(Boolean)
        .join(' · '),
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

  // 시각 없는 사건은 이력이 아니다. 남겨두면 빈 시각으로 맨 앞에 올라와,
  // 시간순임을 전제로 읽는 사람에게 없던 순서를 만들어 낸다.
  const dated = events.filter((e) => normalizeTime(e.at) !== '')
  dated.sort((a, b) => normalizeTime(a.at).localeCompare(normalizeTime(b.at)))
  return dated.map((e) => ({ ...e, at: normalizeTime(e.at) }))
}
