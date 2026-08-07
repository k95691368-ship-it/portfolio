-- 전형 종료와 근로관계 종료가 감사추적에 남지 않았다.
--
-- 두 사건 모두 상태 컬럼(closed_at·close_reason, employment_ended_on)에만
-- 적히고, 취소하면 그 컬럼이 NULL 로 지워진다. 그러면 "종료했다가 되돌렸다"는
-- 사실이 흔적 없이 사라진다.
--
-- 이것이 왜 무거운가.
--
--   전형 종료는 채용절차법 제10조가 알리도록 한 '채용 여부 고지'의 실행이다.
--   언제 끝났다고 알렸는지가 남지 않으면 알린 사실 자체를 증명할 수 없다.
--
--   근로관계 종료일은 계약서 보존 기간 3년의 기산일이다(근로기준법 제42조·
--   시행령 제22조 제2항). 그 날짜를 적었다가 지우면 보존 시계가 통째로
--   되감기는데, 감사추적에는 아무 일도 없었던 것으로 보인다.
--
-- 상태에서 유도하는 대신 일어난 일을 그대로 적는다. 지워지는 값이 아니라
-- 쌓이는 기록이라야 증거가 된다.
--
-- 행위자는 사용자 id 가 아니라 그 시점의 이름으로 남긴다. 계정이 나중에
-- 삭제돼도 누가 했는지는 남아야 하고, 외래키로 묶어 두면 계정 삭제가 이
-- 표 때문에 실패한다.
CREATE TABLE room_lifecycle_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES interview_rooms(id),
  actor_name TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_room_lifecycle_room ON room_lifecycle_log(room_id);
