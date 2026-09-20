-- NULL on previously reviewed applications means unknown history, not unsent.
-- New decisions set pending in the same atomic update as the review result.
ALTER TABLE applications ADD COLUMN result_email_status TEXT
  CHECK (result_email_status IN ('pending','not_sent','sending','sent','failed','unknown'));
ALTER TABLE applications ADD COLUMN result_email_attempted_at TEXT;
ALTER TABLE applications ADD COLUMN result_email_sent_at TEXT;
ALTER TABLE applications ADD COLUMN result_email_error TEXT;
