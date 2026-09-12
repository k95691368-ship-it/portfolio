BEGIN;

-- Separate from job_postings: public job queries can never expose these rows.
CREATE TABLE public.posting_drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL,
  published_at TEXT,
  published_posting_id TEXT
);
CREATE INDEX posting_drafts_owner_updated ON public.posting_drafts(user_id, updated_at DESC)
  WHERE published_at IS NULL;
ALTER TABLE public.posting_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.posting_drafts FROM anon, authenticated;

COMMIT;
