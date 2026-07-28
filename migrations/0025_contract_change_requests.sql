-- 계약 조건 수정 요청.
--
-- 지금까지 계약서는 회사만 쓰고 지원자는 읽거나 서명만 할 수 있었다.
-- 서명 전 점검이 "합의와 다르다"고 알려줘도 지원자가 할 수 있는 일이 없어,
-- 문제를 짚어주고 해결 경로는 없는 반쪽짜리 흐름이었다.
-- 지원자가 항목별로 수정을 요청하고 회사가 수락·거절하도록 한다.
CREATE TABLE contract_change_requests (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES interview_rooms(id),
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  field TEXT NOT NULL,
  current_value TEXT,
  requested_value TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  response_note TEXT,
  responded_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX idx_change_requests_room ON contract_change_requests(room_id, id);
