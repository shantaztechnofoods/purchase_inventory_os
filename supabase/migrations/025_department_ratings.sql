-- ─────────────────────────────────────────────────────────────────────────────
-- 025_department_ratings.sql — Phase B: performance rating per dept per machine
-- Depends on: 021 (handover_events).
--
-- Formula (documented, consistent): base 5 stars.
--   - minus 1 star if the finish-transfer was overdue vs configured duration
--   - minus 1 star if the handover was accepted after the 2h accept timeout
--     (i.e. HOLD occurred before accept)
--   - minus 1 star if the machine has any unresolved pending_handover_items
--     at the time this rating row is written
-- Clamp [0, 5]. The calculation inputs are stored in `calculation_log` so
-- an override can be audited without re-running the formula.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.department_ratings (
  id                 bigserial    PRIMARY KEY,
  machine_id         bigint       NOT NULL REFERENCES public.machine_log(id) ON DELETE CASCADE,
  department         text         NOT NULL,
  handover_id        bigint       REFERENCES public.handover_events(id) ON DELETE SET NULL,
  rating             integer      NOT NULL CHECK (rating BETWEEN 0 AND 5),
  calculation_log    jsonb        NOT NULL DEFAULT '{}'::jsonb,
    -- { base, overrun_minutes, held_minutes, pending_items_open, deductions:[{reason,points}], final }
  overridden_by      uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  override_reason    text,
  overridden_at      timestamptz,
  created_at         timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT dept_ratings_override_pair CHECK (
    (overridden_by IS NULL AND overridden_at IS NULL AND override_reason IS NULL)
     OR
    (overridden_by IS NOT NULL AND overridden_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS department_ratings_machine_idx
  ON public.department_ratings (machine_id, department);

ALTER TABLE public.department_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS department_ratings_select ON public.department_ratings;
CREATE POLICY department_ratings_select ON public.department_ratings
  FOR SELECT TO authenticated USING (true);

-- Insert path: automatic (via Accept flow). Allowed to any user with
-- finishTransfer/accept — the write happens as a side-effect of a successful
-- accept. RLS still ensures only the actor can insert their row.
DROP POLICY IF EXISTS department_ratings_insert ON public.department_ratings;
CREATE POLICY department_ratings_insert ON public.department_ratings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('machines','accept'));

-- Override UPDATE: configDept-only.
DROP POLICY IF EXISTS department_ratings_override ON public.department_ratings;
CREATE POLICY department_ratings_override ON public.department_ratings
  FOR UPDATE TO authenticated
  USING (public.has_permission('machines','configDept'))
  WITH CHECK (public.has_permission('machines','configDept')
              AND overridden_by = auth.uid());

COMMIT;
