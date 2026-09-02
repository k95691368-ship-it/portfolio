-- 화상 면접의 업무 기록과 RealtimeKit 식별자를 분리해 보관한다.
-- 참가자 인증 토큰은 짧게 쓰고 버리는 비밀이므로 어느 표에도 저장하지 않는다.

CREATE TABLE interview_sessions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES interview_rooms(id) ON DELETE CASCADE,
  provider_meeting_id TEXT NOT NULL UNIQUE,
  provider_session_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','waiting','live','ended','cancelled','failed')),
  recording_required INTEGER NOT NULL DEFAULT 1
    CHECK (recording_required IN (0, 1)),
  scheduled_at TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (room_id, idempotency_key)
);

CREATE INDEX idx_interview_sessions_room_created
  ON interview_sessions(room_id, created_at DESC);
CREATE INDEX idx_interview_sessions_provider_session
  ON interview_sessions(provider_session_id);
CREATE INDEX idx_interview_sessions_status
  ON interview_sessions(status);
CREATE UNIQUE INDEX idx_interview_sessions_one_active_per_room
  ON interview_sessions(room_id)
  WHERE status IN ('scheduled', 'waiting', 'live');

-- 관리자 삭제/reset과 세션 생성의 경합을 D1에서 직렬화한다. 외부 provider
-- meeting을 만든 요청도 세션 INSERT 시 이 잠금을 다시 확인하며, 잠겼다면
-- provider meeting을 INACTIVE로 보상 정리한다.
CREATE TABLE interview_room_deletion_locks (
  room_id TEXT PRIMARY KEY REFERENCES interview_rooms(id) ON DELETE CASCADE,
  lock_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 기존 면접방 채팅은 그대로 한 흐름으로 유지하되, 세션 전용 면접관에게는
-- 자신이 등록된 화상 면접에서 오간 공개 메시지만 보여 줄 수 있어야 한다.
ALTER TABLE chat_messages
  ADD COLUMN interview_session_id TEXT
    REFERENCES interview_sessions(id) ON DELETE SET NULL;

CREATE INDEX idx_chat_messages_interview_session
  ON chat_messages(interview_session_id, id);

CREATE TABLE interview_session_members (
  session_id TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('host','interviewer','candidate','observer')),
  custom_participant_id TEXT NOT NULL,
  provider_participant_id TEXT,
  provider_peer_id TEXT,
  admitted_at TEXT,
  joined_at TEXT,
  left_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, user_id),
  UNIQUE (session_id, custom_participant_id),
  UNIQUE (session_id, provider_participant_id)
);

CREATE INDEX idx_interview_members_user
  ON interview_session_members(user_id, session_id);
CREATE INDEX idx_interview_members_custom_id
  ON interview_session_members(custom_participant_id);

CREATE TABLE interview_recording_consents (
  session_id TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notice_version TEXT NOT NULL,
  notice_hash TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  consented_at TEXT,
  revoked_at TEXT,
  ip_address TEXT,
  user_agent TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, user_id, notice_version)
);

CREATE INDEX idx_interview_consents_current
  ON interview_recording_consents(session_id, notice_version, notice_hash, granted);

CREATE TABLE interview_recordings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  provider_recording_id TEXT UNIQUE,
  provider_session_id TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('starting','recording','paused','stopping','processing','available','failed','deleted')),
  r2_key TEXT UNIQUE,
  storage_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (storage_status IN ('pending','copying','stored','copy_failed','deleted')),
  sha256 TEXT,
  size_bytes INTEGER,
  duration_seconds INTEGER,
  content_type TEXT NOT NULL DEFAULT 'video/mp4',
  filename TEXT,
  provider_download_url TEXT,
  provider_download_url_expires_at TEXT,
  retention_until TEXT,
  started_at TEXT,
  stopped_at TEXT,
  failure_reason TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 공급자 호출이 동시에 두 번 일어나 별도 녹화가 생기지 않게 D1에서도 막는다.
CREATE UNIQUE INDEX idx_interview_recordings_one_active
  ON interview_recordings(session_id)
  WHERE status IN ('starting','recording','paused','stopping','processing');
CREATE INDEX idx_interview_recordings_session_created
  ON interview_recordings(session_id, created_at DESC);
CREATE INDEX idx_interview_recordings_retention
  ON interview_recordings(retention_until)
  WHERE deleted_at IS NULL;

CREATE TABLE interview_events (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES interview_sessions(id) ON DELETE CASCADE,
  provider_event_id TEXT UNIQUE,
  event_type TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  details_json TEXT,
  occurred_at TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processing_started_at TEXT,
  processed_at TEXT
);

CREATE INDEX idx_interview_events_session_received
  ON interview_events(session_id, received_at DESC);
CREATE INDEX idx_interview_events_unprocessed
  ON interview_events(processed_at)
  WHERE processed_at IS NULL;

CREATE TABLE recording_access_logs (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL REFERENCES interview_recordings(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('view','download','delete')),
  outcome TEXT NOT NULL CHECK (outcome IN ('allowed','denied','failed')),
  ip_address TEXT,
  user_agent TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_recording_access_recording_created
  ON recording_access_logs(recording_id, created_at DESC);
CREATE INDEX idx_recording_access_user_created
  ON recording_access_logs(user_id, created_at DESC);
