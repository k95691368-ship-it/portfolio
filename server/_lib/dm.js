// 쪽지를 누가 누구에게 보낼 수 있는가.
//
// 이 파일이 이 기능의 전부다. 나머지는 글자를 옮겨 담는 일이고, 위험한
// 것은 여기 한 줄뿐이다 -- 아무나 아무에게나 보낼 수 있으면 계정 목록이
// 그대로 스팸 명단이 된다. 이 서비스의 계정 목록에는 실명과 회사명이 들어
// 있고, 지원자는 지원했다는 이유만으로 거기 올라간다.
//
// 그래서 '먼저 말을 거는 것' 만 막는다:
//
//   1. 관리자는 누구에게나 보낼 수 있다 (운영자가 연락할 방법이 있어야 한다)
//   2. 같은 면접방에 있는 사이면 보낼 수 있다 (이미 서로 아는 사이다)
//   3. 이미 오간 쪽지가 있으면 보낼 수 있다 (답장은 늘 된다)
//
// 3번이 있어야 지원자가 관리자의 쪽지에 답할 수 있다. 3번이 없으면 관리자만
// 일방적으로 말하는 확성기가 된다.
//
// 정지된 계정은 양쪽 다 막는다. 정지는 "이 사람은 이 서비스를 쓸 수 없다"
// 는 뜻인데 쪽지만 계속 오갈 수 있으면 정지가 아니다.
export async function canMessage(env, me, otherId) {
  if (!me || !otherId || me.id === otherId) return { ok: false, reason: '보낼 수 없는 상대입니다.' }

  const other = await env.DB.prepare(
    'SELECT id, display_name, company_name, role, is_admin, is_suspended FROM users WHERE id = ?'
  )
    .bind(otherId)
    .first()

  // 없는 사람과 정지된 사람을 같은 문장으로 돌려준다. 문장이 갈리면 그것만으로
  // "이 이메일의 계정이 있는가" 를 알아낼 수 있다.
  if (!other || other.is_suspended) return { ok: false, reason: '쪽지를 보낼 수 없는 상대입니다.' }
  if (me.is_suspended) return { ok: false, reason: '정지된 계정은 쪽지를 보낼 수 없습니다.' }

  if (me.is_admin) return { ok: true, partner: other }

  const [shared, existing] = await Promise.all([
    env.DB.prepare(
      `SELECT 1 FROM room_participants a
         JOIN room_participants b ON a.room_id = b.room_id
        WHERE a.user_id = ? AND b.user_id = ? LIMIT 1`
    )
      .bind(me.id, otherId)
      .first(),
    env.DB.prepare(
      `SELECT 1 FROM direct_messages
        WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
        LIMIT 1`
    )
      .bind(me.id, otherId, otherId, me.id)
      .first(),
  ])

  if (shared || existing) return { ok: true, partner: other }
  return { ok: false, reason: '같은 면접방에 있는 상대에게만 먼저 쪽지를 보낼 수 있습니다.' }
}

// 화면에 보일 이름. 회사 계정은 회사명을 함께 적는다 -- 담당자 이름만으로는
// 어느 회사 사람인지 알 수 없다.
export function partnerView(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    companyName: row.company_name || null,
    role: row.role,
    isAdmin: !!row.is_admin,
  }
}

export const MAX_BODY = 2000
