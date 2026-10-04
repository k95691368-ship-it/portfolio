import { MAX_SIGNALS, scanForOfferSignals } from './jobOffer.js'

export async function getRoomParticipant(env, roomId, userId) {
  return env.DB.prepare('SELECT role_in_room FROM room_participants WHERE room_id = ? AND user_id = ?')
    .bind(roomId, userId)
    .first()
}

// 채용내정 판정에 쓸 회사 발화를 처음부터 읽는다.
//
// 화면에 뿌리는 메시지 목록을 그대로 판정에 넘기고 있었다. 그 목록은 최근
// 것부터 잘라 오는 창이라, 대화가 길어지면 확정을 성립시킨 문장이 창 밖으로
// 밀려난다. 그 순간 경고가 조용히 꺼진다 — 오래 협의한 방일수록, 그러니까
// 채용내정이 성립했을 가능성이 높은 방일수록 먼저 꺼진다.
//
// 그래서 판정은 화면과 다른 조회를 쓴다. 확정은 회사만 할 수 있으므로 회사
// 발화만 보고(대개 절반 이하다), 성립시킨 것은 처음 그렇게 말한 문장이므로
// 오래된 것부터 읽는다.
const OFFER_SCAN_PAGE_SIZE = 500

// 이 조회의 사용처는 모두 채용내정 판정이다. 전체 본문을 보관하는 대신 기존
// 판정이 보여 줄 최초 strong/weak 각 5개를 대표하는 원문만 남긴다(최대 10개).
// 조회 상한은 한 페이지의 크기이며, 501번째 이후의 첫 통보도 끝까지 찾는다.
export async function loadCompanyMessages(env, roomId) {
  const evidence = []
  let strongCount = 0
  let weakCount = 0
  let upperId = null
  let cursor = null

  while (strongCount < MAX_SIGNALS || weakCount < MAX_SIGNALS) {
    // 첫 페이지와 함께 방 전체 메시지의 시작 상한을 잡아 추가 왕복을 피한다.
    // 지원자 메시지가 상한이어도 아래 역할 조건으로 판정에서는 제외한다. 이후에
    // 도착하는 메시지는 다음 판정에서 읽는다. id는 BIGINT 정밀도를 보존한다.
    const snapshot = upperId === null
      ? 'SELECT MAX(id) AS upper_id FROM chat_messages WHERE room_id = ?'
      : 'SELECT CAST(? AS BIGINT) AS upper_id'
    const statement = env.DB.prepare(
      `WITH offer_scan_snapshot AS (${snapshot})
       SELECT m.body, m.created_at, 'company' AS role_in_room,
              CAST(m.id AS TEXT) AS offer_message_id,
              CAST(scan.upper_id AS TEXT) AS offer_upper_id
       FROM chat_messages m
       CROSS JOIN offer_scan_snapshot scan
       LEFT JOIN room_participants rp
         ON rp.room_id = m.room_id AND rp.user_id = m.sender_user_id
      WHERE m.room_id = ?
        AND m.id <= scan.upper_id
        ${cursor === null ? '' : 'AND m.id > ?'}
        AND (
          rp.role_in_room = 'company'
          OR EXISTS (
            SELECT 1
              FROM interview_session_members ism
              JOIN interview_sessions video_session ON video_session.id = ism.session_id
             WHERE video_session.room_id = m.room_id
               AND ism.user_id = m.sender_user_id
               AND ism.role IN ('host','interviewer')
          )
        )
      ORDER BY m.id ASC
      LIMIT ?`
    )
    const { results } = await (cursor === null
      ? statement.bind(roomId, roomId, OFFER_SCAN_PAGE_SIZE)
      : statement.bind(upperId, roomId, cursor, OFFER_SCAN_PAGE_SIZE)).all()
    const page = results || []
    if (page.length === 0) break
    upperId ??= page[0].offer_upper_id

    for (const message of page) {
      const signals = scanForOfferSignals([message])
      const keepStrong = strongCount < MAX_SIGNALS && signals.strong.length > 0
      const keepWeak = weakCount < MAX_SIGNALS && signals.weak.length > 0
      if (keepStrong || keepWeak) {
        evidence.push({ body: message.body, created_at: message.created_at, role_in_room: message.role_in_room })
        if (keepStrong) strongCount++
        if (keepWeak) weakCount++
      }
      if (strongCount === MAX_SIGNALS && weakCount === MAX_SIGNALS) return evidence
    }
    cursor = page[page.length - 1].offer_message_id
    if (page.length < OFFER_SCAN_PAGE_SIZE) break
  }
  return evidence
}

// 참여 여부와 방 상태를 한 번에 읽는다.
//
// 보관 잠금을 넣으면서 대화 전송에 조회가 하나 늘었다 — 참여자 확인 한 번,
// 방 상태 한 번. 며칠 전 왕복 셋을 둘로 줄여 놓은 바로 그 자리다. 두 값은
// 같은 방에 대한 것이라 한 번에 읽을 수 있다.
//
// 참여하지 않았으면 role_in_room 이 NULL 로 온다. 방이 아예 없으면 행이 없다.
export async function getRoomParticipation(env, roomId, userId) {
  return env.DB.prepare(
    `SELECT r.id, r.title, r.status, r.archived_at, r.last_message_email_at, rp.role_in_room
       FROM interview_rooms r
       LEFT JOIN room_participants rp ON rp.room_id = r.id AND rp.user_id = ?
      WHERE r.id = ?`
  )
    .bind(userId, roomId)
    .first()
}

// 열람 권한: 참여자면 그 역할, 참여자가 아니어도 관리자면 'admin'(읽기 전용 열람).
// 쓰기(메시지 전송, 분석, 서명 등)에는 사용하지 말 것 — 그건 getRoomParticipant로 참여자만 허용.
export async function getRoomAccess(env, roomId, user) {
  if (!user) return null
  const participant = await getRoomParticipant(env, roomId, user.id)
  if (participant) return participant
  if (user.is_admin) return { role_in_room: 'admin' }
  return null
}
