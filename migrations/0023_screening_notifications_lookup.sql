-- 지원서 AI 스크리닝 결과 + 지원 현황 조회 코드 + 인앱 알림 센터

ALTER TABLE applications ADD COLUMN ai_screening_json TEXT;
ALTER TABLE applications ADD COLUMN screened_at TEXT;
ALTER TABLE applications ADD COLUMN lookup_code TEXT;
CREATE UNIQUE INDEX idx_applications_lookup_code ON applications(lookup_code) WHERE lookup_code IS NOT NULL;

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id, id);
