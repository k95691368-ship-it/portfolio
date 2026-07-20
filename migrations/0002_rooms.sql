CREATE TABLE interview_rooms (
  id TEXT PRIMARY KEY,
  company_user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','active','contract_pending','signed','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE TABLE room_participants (
  room_id TEXT NOT NULL REFERENCES interview_rooms(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role_in_room TEXT NOT NULL CHECK (role_in_room IN ('company','candidate')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, user_id)
);
