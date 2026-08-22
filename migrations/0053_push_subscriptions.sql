-- 창을 닫아도 알림이 도착하려면, 어디로 보낼지를 서버가 들고 있어야 한다.
--
-- 브라우저가 알림을 허용하면 "이 기기로 밀어 주세요"라는 주소(endpoint)와
-- 그 기기만 열 수 있는 열쇠 두 개(p256dh, auth)를 준다. 이 세 값이 있어야
-- 브라우저 회사의 서버를 거쳐 그 사람에게 닿는다.
--
-- 열쇠를 저장하지만 이것으로 이 서버가 무엇을 훔쳐볼 수 있는 것은 아니다.
-- 보내는 쪽 열쇠이고, 오히려 이것으로 암호화해야 밀어 주는 서버가 내용을
-- 못 읽는다.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  -- 어느 기기인지 사람이 알아볼 수 있게. 여러 기기를 쓰면 목록에서 구분된다.
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 한 사람이 회사 PC·집 노트북처럼 여러 기기를 쓴다. 보낼 때 그 사람의 것을
-- 전부 찾아야 하므로 사람으로 찾는 길을 낸다.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
