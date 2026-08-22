import { isEmailConfigured, sendNewMessageEmail } from './email.js'
import { notifyUser } from './notify.js'

// 새 메시지가 왔다는 것을 상대에게 어떻게 알리는가.
//
// 두 사람이 이 화면을 쓰는 방식이 다르다.
//
//   회사 담당자는 일하는 내내 이 사이트를 열어 둔다. 채용은 그의 업무다.
//   그래서 화면이 떠 있는 동안 컴퓨터 알림으로 알리는 것이 맞다 -- 메일함을
//   또 열게 하는 것은 일을 하나 더 만드는 것이다.
//
//   지원자는 그렇지 않다. 코드로 한 번 들어왔다 나가면 그만이고, 다음에 언제
//   들어올지 모른다. 화면이 닫혀 있으면 컴퓨터 알림은 도착할 곳이 없다. 그
//   사람에게 닿는 유일한 통로는 지원할 때 적은 메일 주소다.
//
// 그래서 방향에 따라 수단을 나눈다.
//   회사 -> 지원자 : 이메일 (이 파일)
//   지원자 -> 회사 : 컴퓨터 알림 (화면 쪽 src/lib/desktopAlert.js)
// 인앱 알림(종 모양)은 양쪽 모두 남긴다 -- 놓쳐도 나중에 볼 수 있어야 한다.

// 같은 방에서 메일을 다시 보내기까지 두는 시간.
//
// 대화는 한 번에 여러 줄이 오간다. 줄마다 메일을 보내면 지원자의 메일함이
// 막히고, 그러면 정작 중요한 메일(서류합격, 최종합격)이 그 사이에 묻힌다.
// 첫 줄에만 보내고 그 뒤 30분은 조용히 있는다.
const EMAIL_QUIET_MINUTES = 30

// 지원자가 방을 보고 있는 동안에는 메일을 보내지 않는다.
//
// 눈앞에서 대화하는 사람에게 "새 메시지가 도착했습니다" 메일을 보내는 것은
// 알림이 아니라 방해다. 마지막으로 읽은 시각이 이 안이면 건너뛴다.
const ACTIVE_MINUTES = 3

export function shouldEmailCandidate({ lastEmailAt, lastSeenAt, now }) {
  const at = (v) => {
    if (!v) return null
    const t = Date.parse(String(v).replace(' ', 'T').replace(/Z?$/, 'Z'))
    return Number.isFinite(t) ? t : null
  }
  const nowMs = at(now) ?? Date.now()

  const seen = at(lastSeenAt)
  if (seen !== null && nowMs - seen < ACTIVE_MINUTES * 60_000) return false

  const sent = at(lastEmailAt)
  if (sent !== null && nowMs - sent < EMAIL_QUIET_MINUTES * 60_000) return false

  return true
}

// 회사가 보낸 메시지를 지원자에게 알린다.
//
// 알림이 실패해도 대화는 저장된 뒤다. 메시지 전송을 되돌리지 않는다 --
// 알림 한 번을 위해 오간 말을 지우는 것이 훨씬 나쁘다.
export async function alertCandidate(env, { roomId, room, candidate, companyName, body }) {
  if (!candidate?.id) return { emailed: false, reason: 'no_candidate' }

  await notifyUser(env, candidate.id, {
    type: 'message',
    message: `${companyName || '회사'}에서 새 메시지를 보냈습니다.`,
    link: `/rooms/${roomId}`,
  })

  if (!candidate.email || !isEmailConfigured(env)) {
    return { emailed: false, reason: 'email_off' }
  }

  const decide = shouldEmailCandidate({
    lastEmailAt: room?.last_message_email_at ?? null,
    lastSeenAt: candidate.last_seen_at ?? null,
    now: null,
  })
  if (!decide) return { emailed: false, reason: 'quiet' }

  // 보냈다는 사실을 먼저 적는다.
  //
  // 발송이 성공한 뒤에 적으면, 같은 순간에 들어온 두 번째 메시지가 아직
  // 비어 있는 값을 읽고 함께 보낸다. 메일이 두 통 나간다.
  const claimed = await env.DB.prepare(
    `UPDATE interview_rooms SET last_message_email_at = datetime('now')
      WHERE id = ?
        AND (last_message_email_at IS NULL
             OR datetime(last_message_email_at) <= datetime('now', ?))`
  )
    .bind(roomId, `-${EMAIL_QUIET_MINUTES} minutes`)
    .run()
    .catch(() => null)
  if (!claimed?.meta?.changes) return { emailed: false, reason: 'raced' }

  try {
    await sendNewMessageEmail(env, {
      to: candidate.email,
      companyName,
      roomTitle: room?.title ?? '면접방',
      preview: body,
    })
    return { emailed: true }
  } catch (err) {
    console.error(`new message email failed (${roomId}):`, err)
    // 보내지 못했으면 표시를 되돌린다. 그대로 두면 다음 메시지도 조용히
    // 건너뛰어, 지원자는 아무 소식도 못 받는다.
    await env.DB.prepare(
      'UPDATE interview_rooms SET last_message_email_at = NULL WHERE id = ?'
    )
      .bind(roomId)
      .run()
      .catch(() => {})
    return { emailed: false, reason: 'failed' }
  }
}

// 지원자가 보낸 메시지를 회사에 알린다.
//
// 컴퓨터 알림은 브라우저가 띄우므로 서버가 할 일은 인앱 기록뿐이다. 화면이
// 폴링으로 새 메시지를 받는 순간 알림을 띄운다.
export async function alertCompany(env, { roomId, companyUserId, candidateName }) {
  if (!companyUserId) return
  await notifyUser(env, companyUserId, {
    type: 'message',
    message: `${candidateName || '지원자'}님이 새 메시지를 보냈습니다.`,
    link: `/rooms/${roomId}`,
  })
}
