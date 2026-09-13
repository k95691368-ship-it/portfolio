-- Existing records keep NULL: never invent historical consent evidence.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS consent_version TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS consent_snapshot TEXT;
ALTER TABLE interview_session_members ADD COLUMN IF NOT EXISTS signaling_seen_at TEXT;
ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS huddle_active INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS interview_signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL, payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT datetime('now')
);
CREATE INDEX IF NOT EXISTS interview_signals_inbox ON interview_signals(session_id, recipient_id, id);
ALTER TABLE interview_signals ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('sending','accepted','failed','unknown')),
  provider_id TEXT, created_at TEXT NOT NULL DEFAULT datetime('now'), updated_at TEXT NOT NULL DEFAULT datetime('now')
);
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE final_offer_emails DROP CONSTRAINT IF EXISTS final_offer_emails_status_check;
ALTER TABLE final_offer_emails ADD CONSTRAINT final_offer_emails_status_check CHECK (status IN ('sending','sent','failed','unknown'));
ALTER TABLE final_offer_emails ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE interview_recordings ADD COLUMN IF NOT EXISTS retention_hold_reason TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS retention_hold_reason TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS purged_at TEXT;
CREATE TABLE IF NOT EXISTS retention_jobs (
  id TEXT PRIMARY KEY, lock_token TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('running','failed','done')),
  attempts INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT datetime('now')
);
ALTER TABLE retention_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE signed_contracts DROP CONSTRAINT IF EXISTS signed_contracts_email_status_check;
ALTER TABLE signed_contracts ADD CONSTRAINT signed_contracts_email_status_check CHECK (email_status IN ('not_sent','sent','failed','unknown'));
ALTER TABLE contract_deliveries DROP CONSTRAINT IF EXISTS contract_deliveries_status_check;
ALTER TABLE contract_deliveries ADD CONSTRAINT contract_deliveries_status_check CHECK (status IN ('delivered','viewed','failed','unknown'));
