import { describeOfferStatus } from './jobOffer.js'
import { loadCompanyMessages } from './rooms.js'

// 합격 이메일을 보내는 순간 채용내정이 확정된다.
//
// 이것이 이 서비스의 핵심이다.
//
// 채용내정은 회사가 "당신을 채용하겠다"는 뜻을 근로자에게 알린 때 성립한 것으로
// 다뤄진다. 그 알림의 가장 전형적인 형태가 최종합격 통보 메일이다. 채팅 문장은
// 나중에 "그런 뜻이 아니었다"고 다툴 여지가 있지만, 회사 계정으로 지원자에게
// 실제로 발송된 메일은 보낸 사람·받는 사람·시각·내용이 모두 남아 그 다툼의
// 여지가 훨씬 작다.
//
// 그런데 지금까지 이 앱은 메일을 보내도 확정으로 치지 않았다. 담당자가 계약서
// 화면에서 '채용 확정하기'를 따로 누르거나, AI 가 대화를 훑어 확정 표현을
// 찾아야만 확정됐다. 즉 회사가 법적으로 가장 무거운 행동을 하고도 시스템은
// "아직 확정 전"이라고 표시했고, 그 상태에서 전형을 종료하면 해고 경고도
// 뜨지 않았다. 막으려던 사고가 정확히 그 자리에서 일어난다.
//
// 발송에 성공했을 때만 확정한다. 실패한 발송은 통지가 아니다.

// 확정의 근거로 남길 문장.
//
// 나중에 "언제 무엇으로 확정됐는가"를 다투는 자리에서 읽힌다. 메일이라는
// 사실과 수신자·제목·시각이 함께 있어야 근거가 된다.
export function offerExcerptFromEmail({ recipientEmail, subject, sentAt }) {
  const parts = ['최종합격 이메일 발송']
  if (recipientEmail) parts.push(`수신 ${recipientEmail}`)
  if (subject) parts.push(`제목 "${String(subject).slice(0, 120)}"`)
  if (sentAt) parts.push(sentAt)
  return parts.join(' · ')
}

// 메일 발송으로 채용내정을 확정한다.
//
// 이미 확정되어 있으면 덮지 않는다. 먼저 성립한 시점이 곧 채용내정 성립
// 시점이고, 그것을 나중 사건으로 밀면 성립일이 늦춰진다 — 해고 여부를 다투는
// 자리에서 그 날짜가 쟁점이 된다.
//
// 돌려주는 값: { confirmed, alreadyConfirmed }
export async function confirmHireByEmail(env, roomId, { recipientEmail, subject, sentAt }) {
  const excerpt = offerExcerptFromEmail({ recipientEmail, subject, sentAt })

  const claim = await env.DB.prepare(
    `INSERT INTO contract_terms (room_id, hire_confirmed, hire_confirmed_at, hire_confirmation_excerpt)
     VALUES (?, 1, datetime('now'), ?)
     ON CONFLICT(room_id) DO UPDATE SET
       hire_confirmed = 1,
       hire_confirmed_at = COALESCE(contract_terms.hire_confirmed_at, datetime('now')),
       hire_confirmation_excerpt =
         COALESCE(contract_terms.hire_confirmation_excerpt, excluded.hire_confirmation_excerpt),
       -- updated_at 을 올려야 한다. 이 값을 보고 "그 사이 조건이 바뀌었는가"를
       -- 판단하는 곳(AI 조건 정리의 덮어쓰기 방지, 서명의 조건부 INSERT)이
       -- 이 변경을 보지 못하면, 확정 뒤에 도착한 AI 결과가 hire_confirmed 를
       -- 0 으로 되돌린다.
       updated_at = datetime('now')
     WHERE contract_terms.hire_confirmed = 0`
  )
    .bind(roomId, excerpt)
    .run()

  return { confirmed: claim.meta.changes > 0, alreadyConfirmed: claim.meta.changes === 0, excerpt }
}

// 이 지원서에 연결된 방에서 채용내정이 성립했는가.
//
// 탈락 처리를 막을지 판단하는 자리에서 쓴다. 지원서 단계에서는 방이 아직
// 없을 수 있고(서류 심사 전), 그때는 성립할 것도 없다.
//
// 판정은 계약서 화면·면접방과 같은 함수를 쓴다. 여기서만 다른 규칙을 쓰면
// "면접방에서는 확정이라는데 지원서에서는 탈락이 눌린다"가 되어, 두 화면 중
// 하나는 반드시 거짓말이 된다.
export async function offerStatusForApplication(env, application) {
  const roomId = application?.room_id
  if (!roomId) return { established: false, reason: 'no_room' }

  const [termsRow, companyMessages] = await Promise.all([
    env.DB.prepare('SELECT * FROM contract_terms WHERE room_id = ?').bind(roomId).first(),
    loadCompanyMessages(env, roomId),
  ])

  const status = describeOfferStatus({ terms: termsRow, messages: companyMessages })
  return {
    established: !!status.established,
    confirmedAt: status.confirmedAt ?? null,
    excerpt: status.excerpt ?? null,
    risk: status.risk ?? null,
  }
}
