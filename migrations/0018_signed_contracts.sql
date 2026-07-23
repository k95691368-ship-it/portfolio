-- 서명 완료된 근로계약서 보관(R2) + 지원자 이메일 발송 기록

CREATE TABLE signed_contracts (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL UNIQUE REFERENCES interview_rooms(id),
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  stored_by_user_id TEXT NOT NULL REFERENCES users(id),
  email_status TEXT NOT NULL DEFAULT 'not_sent' CHECK (email_status IN ('not_sent', 'sent', 'failed')),
  email_error TEXT,
  emailed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
