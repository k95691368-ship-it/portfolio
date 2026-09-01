-- 사람과 사람 사이의 쪽지.
--
-- 면접방 대화와는 다른 것이다. 방 대화는 그 채용 건의 기록이고, 나중에
-- 채용내정이 성립했는지 판정하는 근거로 읽힌다. 여기 오가는 말은 그 판정에
-- 들어가지 않는다 -- 담당자끼리 "이 지원자 어때요" 하고 묻는 자리다.
--
-- 그래서 방 메시지 표에 얹지 않고 따로 둔다. 얹었다면 방 없는 대화를 담기
-- 위해 room_id 를 비워야 하고, 그 순간 채용내정 판정 질의가 전부
-- "room_id IS NOT NULL" 을 붙여야 하는 표가 된다. 하나라도 빠뜨리면 사담이
-- 회사의 채용 확정 발언으로 잡힌다.
CREATE TABLE direct_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 읽은 시각. 안 읽었으면 NULL.
  read_at TEXT
);

-- 두 사람 사이의 대화를 시간순으로 읽는다. 보낸 쪽과 받는 쪽이 번갈아
-- 바뀌므로 한 쌍을 정렬한 키(작은 id, 큰 id)로 묶어 둔다.
CREATE INDEX idx_dm_pair ON direct_messages(
  CASE WHEN sender_id < recipient_id THEN sender_id ELSE recipient_id END,
  CASE WHEN sender_id < recipient_id THEN recipient_id ELSE sender_id END,
  id
);

-- 안 읽은 것 세기. 화면이 20초마다 두드리는 질의라 색인이 없으면
-- 사람 수만큼 전체 훑기가 된다.
CREATE INDEX idx_dm_inbox ON direct_messages(recipient_id, read_at, id);
