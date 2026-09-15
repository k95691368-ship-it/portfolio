CREATE TABLE public.interview_slots (
  id TEXT PRIMARY KEY,
  company_user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes IN (15,30,45,60,90,120)),
  recording_required INTEGER NOT NULL DEFAULT 1 CHECK (recording_required IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX interview_slots_company_time ON public.interview_slots(company_user_id, starts_at) WHERE active = 1;
ALTER TABLE public.interview_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.interview_slots FROM anon, authenticated;
ALTER TABLE public.interview_sessions ADD COLUMN booking_slot_id TEXT REFERENCES public.interview_slots(id) ON DELETE SET NULL;
ALTER TABLE public.interview_sessions ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes IN (15,30,45,60,90,120));
CREATE UNIQUE INDEX interview_sessions_booked_slot ON public.interview_sessions(booking_slot_id)
  WHERE booking_slot_id IS NOT NULL AND status IN ('scheduled','waiting','live');
