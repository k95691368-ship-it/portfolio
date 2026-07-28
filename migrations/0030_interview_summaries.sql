-- 면접 대화의 회사 보관용 요약 기록.
--
-- 이 서비스의 축은 "대화 → 계약서"인데, 그동안 대화에서 뽑아낸 것은 계약
-- 조건뿐이었다. 무슨 이야기가 오갔는지, 무엇이 아직 정해지지 않았는지는
-- 채팅 원문을 처음부터 다시 읽어야만 알 수 있었다.
--
-- 요약은 평가서가 아니라 기록이다. 지원자를 점수로 매기지 않고, 직무와
-- 무관한 개인정보(연령·성별·출신지역·혼인관계 등)는 담지 않는다.
-- 채용절차의 공정화에 관한 법률 제4조의3의 취지에 따른 것이다.
CREATE TABLE interview_summaries (
  room_id TEXT PRIMARY KEY REFERENCES interview_rooms(id),
  summary_json TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_id INTEGER,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
