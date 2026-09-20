BEGIN;
ALTER TABLE public.users ADD COLUMN email_verified_at TEXT;
ALTER TABLE public.users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'pending'));
CREATE TABLE public.account_recovery_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  email TEXT NOT NULL,
  password_snapshot TEXT NOT NULL,
  persistent INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX account_recovery_user ON public.account_recovery_tokens(user_id, purpose);
CREATE INDEX account_recovery_expiry ON public.account_recovery_tokens(expires_at);
ALTER TABLE public.account_recovery_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_recovery_tokens FROM PUBLIC, anon, authenticated;
COMMIT;
