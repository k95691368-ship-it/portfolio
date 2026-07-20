CREATE TABLE signatures (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES interview_rooms(id),
  signer_user_id TEXT NOT NULL REFERENCES users(id),
  signer_role TEXT NOT NULL CHECK (signer_role IN ('company','candidate')),
  image_data_url TEXT NOT NULL,
  signed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(room_id, signer_role)
);
