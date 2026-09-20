ALTER TABLE applications ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE applications ADD COLUMN withdrawn_at TEXT;
ALTER TABLE applications ADD COLUMN last_edit_operation TEXT;
ALTER TABLE applications ADD COLUMN submission_key_hash TEXT;
CREATE UNIQUE INDEX idx_application_submission_key ON applications(submission_key_hash) WHERE submission_key_hash IS NOT NULL;
DROP INDEX idx_applications_one_submitted;
CREATE UNIQUE INDEX idx_applications_one_submitted ON applications(posting_id, applicant_email)
  WHERE status = 'submitted' AND withdrawn_at IS NULL;
ALTER TABLE application_documents ADD COLUMN superseded_at TEXT;
CREATE TABLE application_access_tokens (
  token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE application_access_sessions (
  token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_application_access_expiry ON application_access_tokens(expires_at);
CREATE INDEX idx_application_sessions_expiry ON application_access_sessions(expires_at);
CREATE TABLE application_upload_staging (
  storage_key TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
