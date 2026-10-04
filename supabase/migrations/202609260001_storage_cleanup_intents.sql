-- Additive migration only; apply separately before deploying cleanup consumers.
-- These receipts survive parent deletion and contain no document body or token.
-- SQLite-compatible timestamp strings are UTC even when a database connection
-- uses a local timezone. Scope this setting to the parsing functions only.
ALTER FUNCTION public.datetime(TEXT) SET timezone TO 'UTC';
ALTER FUNCTION public.datetime(TEXT, TEXT) SET timezone TO 'UTC';
ALTER FUNCTION public.datetime(TEXT, TEXT, TEXT) SET timezone TO 'UTC';
ALTER FUNCTION public.date(TEXT, TEXT) SET timezone TO 'UTC';
ALTER FUNCTION public.julianday(TEXT) SET timezone TO 'UTC';

CREATE TABLE IF NOT EXISTS storage_cleanup_intents (
  bucket TEXT NOT NULL CHECK (bucket IN ('documents', 'interview-recordings')),
  storage_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  not_before TEXT NOT NULL DEFAULT (datetime('now')),
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (bucket, storage_key)
);
CREATE INDEX IF NOT EXISTS idx_storage_cleanup_due ON storage_cleanup_intents(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_storage_cleanup_operation ON storage_cleanup_intents(operation_id);
ALTER TABLE storage_cleanup_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON storage_cleanup_intents FROM PUBLIC, anon, authenticated;
