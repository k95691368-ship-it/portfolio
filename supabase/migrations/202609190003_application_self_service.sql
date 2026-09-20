ALTER TABLE applications ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS withdrawn_at TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS last_edit_operation TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS submission_key_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_application_submission_key ON applications(submission_key_hash) WHERE submission_key_hash IS NOT NULL;
DROP INDEX IF EXISTS idx_applications_one_submitted;
CREATE UNIQUE INDEX idx_applications_one_submitted ON applications(posting_id, applicant_email)
  WHERE status = 'submitted' AND withdrawn_at IS NULL;
ALTER TABLE application_documents ADD COLUMN IF NOT EXISTS superseded_at TEXT;
CREATE TABLE IF NOT EXISTS application_access_tokens (
  token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS application_access_sessions (
  token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_application_access_expiry ON application_access_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_application_sessions_expiry ON application_access_sessions(expires_at);
ALTER TABLE application_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_access_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON application_access_tokens, application_access_sessions FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS application_upload_staging (
  storage_key TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE application_upload_staging ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON application_upload_staging FROM PUBLIC, anon, authenticated;
