CREATE TABLE contract_edit_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES interview_rooms(id),
  editor_user_id TEXT NOT NULL REFERENCES users(id),
  changes TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_contract_edit_history_room ON contract_edit_history(room_id, id);
