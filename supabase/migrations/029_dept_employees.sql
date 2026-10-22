-- ─────────────────────────────────────────────────────────────────────────────
-- 029_dept_employees.sql — Department-wise employee assignment + Main Employee
-- signature on handover.
-- Depends on: 001 (public.users), 021 (handover_events + employee_signatures).
--
-- Reuses the existing users / employee_signatures / handover_events tables —
-- NO new login or role system is created. Strictly additive, all new columns
-- nullable (or with a safe empty-array default) so legacy rows keep working.
--
-- Two logical additions:
--   1. users.departments  (text[], default '{}')  — which of the four factory
--      departments (Assembly / Mechanical / Electrical / Trial) a user is
--      assigned to. Picked at Settings → Department Workflow by an admin.
--
--   2. handover_events extensions — snapshot of who worked on the department
--      for THIS machine + the Main/Responsible Employee + the Main Employee's
--      stored signature id. The jsonb snapshot (`worked_by_snapshot`) carries
--      denormalized full_name / username so Reports still render correctly
--      even if a user is later renamed or deactivated.
--
-- Strictly additive. No RLS change. No destructive op.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. users.departments ─────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS departments text[] NOT NULL DEFAULT '{}'::text[];

-- GIN index so the "list users in Assembly" lookup can use an index on the
-- array column. Low cardinality (max 4 departments per user) so overhead is
-- negligible.
CREATE INDEX IF NOT EXISTS users_departments_gin_idx
  ON public.users USING gin (departments);

-- ─── 2. handover_events: worked_by + main_employee + snapshot ─────────────
ALTER TABLE public.handover_events
  ADD COLUMN IF NOT EXISTS worked_by                   uuid[],
  ADD COLUMN IF NOT EXISTS worked_by_snapshot          jsonb,
  ADD COLUMN IF NOT EXISTS main_employee_id            uuid
                                        REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS main_employee_signature_id  bigint
                                        REFERENCES public.employee_signatures(id)
                                        ON DELETE SET NULL,
  -- Inline SVG snapshot of the Main Employee's signature. Needed when the
  -- Main Employee is NOT the currently-logged-in user (factory terminal
  -- shared by many workers — RLS only allows self-write on
  -- employee_signatures). Having both is fine: _id links to the user's
  -- stored signature when available, _svg is the authoritative per-handover
  -- proof. One or both is populated for 029+ handovers.
  ADD COLUMN IF NOT EXISTS main_employee_signature_svg text;

-- Belt-and-braces: the UI already enforces this, but the DB rejects a
-- handover whose Main Employee isn't among the selected workers. Legacy
-- rows (worked_by IS NULL) are exempt so the migration is non-destructive.
ALTER TABLE public.handover_events
  DROP CONSTRAINT IF EXISTS handover_main_in_worked;
ALTER TABLE public.handover_events
  ADD CONSTRAINT handover_main_in_worked
    CHECK (main_employee_id IS NULL
           OR worked_by IS NULL
           OR main_employee_id = ANY(worked_by));

CREATE INDEX IF NOT EXISTS handover_events_worked_by_gin_idx
  ON public.handover_events USING gin (worked_by);

COMMIT;
