-- File removal follows a committed parent deletion. No parent FK may erase the
-- exact cleanup target before the storage provider confirms deletion.
CREATE TABLE storage_cleanup_intents (
  bucket TEXT NOT NULL CHECK (bucket IN ('documents', 'interview-recordings')),
  storage_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  not_before TEXT NOT NULL DEFAULT (datetime('now')),
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (bucket, storage_key)
);
CREATE INDEX idx_storage_cleanup_due ON storage_cleanup_intents(next_attempt_at);
CREATE INDEX idx_storage_cleanup_operation ON storage_cleanup_intents(operation_id);
