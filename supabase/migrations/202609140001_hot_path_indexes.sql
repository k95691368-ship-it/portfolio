-- Additive only: no production records are changed or removed.
-- Filter recent inbox entries before sorting, rather than scanning the entire meeting history.
CREATE INDEX IF NOT EXISTS interview_signals_recent_inbox
  ON interview_signals(session_id, recipient_id, created_at, id);
-- Global expiry scans cannot use the existing bucket/session-first indexes efficiently.
CREATE INDEX IF NOT EXISTS interview_signals_created_at ON interview_signals(created_at);
CREATE INDEX IF NOT EXISTS rate_limit_hits_created_at ON rate_limit_hits(created_at);
