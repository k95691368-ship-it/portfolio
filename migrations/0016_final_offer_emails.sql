CREATE TABLE final_offer_emails (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL UNIQUE REFERENCES interview_rooms(id),
  sent_by_user_id TEXT NOT NULL REFERENCES users(id),
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE INDEX idx_final_offer_emails_status ON final_offer_emails(status);
