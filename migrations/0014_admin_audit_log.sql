CREATE TABLE admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target_user_id TEXT REFERENCES users(id),
  target_room_id TEXT REFERENCES interview_rooms(id),
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_admin_audit_log_created_at ON admin_audit_log(created_at);
