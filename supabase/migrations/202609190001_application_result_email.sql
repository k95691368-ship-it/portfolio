-- Do not backfill old outcomes as unsent: Gmail may already have accepted them.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS result_email_status TEXT
  CHECK (result_email_status IN ('pending','not_sent','sending','sent','failed','unknown'));
ALTER TABLE applications ADD COLUMN IF NOT EXISTS result_email_attempted_at TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS result_email_sent_at TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS result_email_error TEXT;
