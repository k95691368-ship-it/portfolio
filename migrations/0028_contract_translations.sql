-- 외국인 근로자용 계약서 번역본.
--
-- 국내 외국인 근로자가 읽지 못하는 한국어 계약서에 서명하는 일은 실제로 흔하고,
-- 고용노동부 표준근로계약서에도 공식 외국어본이 존재한다. 계약 내용을 이미
-- 구조화해 갖고 있으므로, 같은 내용을 근로자의 언어로 함께 보여준다.
--
-- 원본(한국어)은 그대로 두고 번역본을 따로 보관한다. 법적 효력은 원본에 있고
-- 번역본은 이해를 돕기 위한 것임을 화면과 문서에 명시한다.
CREATE TABLE contract_translations (
  room_id TEXT NOT NULL REFERENCES interview_rooms(id),
  language TEXT NOT NULL,
  articles_json TEXT NOT NULL,
  translated_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, language)
);
