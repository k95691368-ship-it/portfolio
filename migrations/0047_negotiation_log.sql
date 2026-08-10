-- 처우 협의 이력.
--
-- 근로조건은 계약서에 적히기 전에 대화에서 먼저 정해진다. 그런데 그 과정이
-- 어디에도 남지 않았다. 계약서 수정 이력은 계약서를 고친 뒤부터의 이야기이고,
-- 그 앞에서 무엇을 제시하고 무엇을 받아들였는지는 채팅 로그 수백 줄 안에
-- 흩어져 있다.
--
-- 두 가지를 위해 남긴다.
--
--   채용내정이 성립했는지 판단하려면 "무엇을 약속했는가"가 있어야 한다.
--   조건 없이 "합격입니다"만으로는 계약 내용이 특정되지 않는다.
--
--   확정 뒤에 조건이 불리하게 바뀌었는지 따지려면 기준이 있어야 한다. 회사가
--   "원래 그렇게 말한 적 없다"고 할 때, 언제 누가 무엇을 말했는지가 필요하다.
--
-- 발화자는 이름이 아니라 역할로 남긴다. 누가 제시한 값인지가 중요하지
-- 개인을 특정할 필요는 없고, 계정이 지워져도 이력은 남아야 한다.
CREATE TABLE negotiation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES interview_rooms(id),
  message_id INTEGER,
  speaker_role TEXT NOT NULL,
  field TEXT NOT NULL,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  value_display TEXT NOT NULL,
  previous_value TEXT,
  excerpt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_negotiation_room ON negotiation_log(room_id, id);
