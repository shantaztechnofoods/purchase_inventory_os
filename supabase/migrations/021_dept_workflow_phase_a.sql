-- ─────────────────────────────────────────────────────────────────────────────
-- 021_dept_workflow_phase_a.sql — Department workflow foundations
-- Depends on: 001-020. Fully additive. No existing column renamed or dropped.
-- See docs/department-workflow-phase-a.md for the design rationale.
-- Rollback: see 021_dept_workflow_phase_a_rollback.sql.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. employee_signatures ─────────────────────────────────────────────────
-- One signature per user (UNIQUE user_id). Stored as serialized SVG text so
-- rows stay small; no Storage bucket needed in Phase A. Signature alone is
-- NOT proof of authorization — the acceptance flow re-verifies the user's
-- password at accept-time (see §5.4 of the design doc).

CREATE TABLE IF NOT EXISTS public.employee_signatures (
  id            bigserial    PRIMARY KEY,
  user_id       uuid         NOT NULL UNIQUE
                             REFERENCES auth.users(id) ON DELETE CASCADE,
  signature_svg text         NOT NULL CHECK (length(signature_svg) > 0),
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_signatures_user_idx
  ON public.employee_signatures (user_id);

-- updated_at trigger (reuses the set_updated_at() helper from 001)
DROP TRIGGER IF EXISTS employee_signatures_updated_at ON public.employee_signatures;
CREATE TRIGGER employee_signatures_updated_at
  BEFORE UPDATE ON public.employee_signatures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.employee_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signatures_select_self ON public.employee_signatures;
CREATE POLICY signatures_select_self ON public.employee_signatures
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS signatures_insert_self ON public.employee_signatures;
CREATE POLICY signatures_insert_self ON public.employee_signatures
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS signatures_update_self ON public.employee_signatures;
CREATE POLICY signatures_update_self ON public.employee_signatures
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE: no policy, default deny — signatures are append-replace only.

-- ─── 2. handover_events ─────────────────────────────────────────────────────
-- Audit of every Finish & Transfer → Accept transition. Durations snapshot
-- at send time so historical reads never shift when admins change duration
-- config. HOLD state is computed on UI render (status stays 'pending' until
-- accepted); accept_timeout_minutes is snapshot so the HOLD computation
-- doesn't move either.

CREATE TABLE IF NOT EXISTS public.handover_events (
  id                        bigserial    PRIMARY KEY,
  machine_id                bigint       NOT NULL
                                         REFERENCES public.machine_log(id)
                                         ON DELETE CASCADE,
  bom_key                   text         NOT NULL,
  serial_no                 text,
  from_department           text         NOT NULL CHECK (from_department IN
                             ('BOM Issued','Assembly','Mechanical','Electrical','Trial')),
  to_department             text         NOT NULL CHECK (to_department IN
                             ('Assembly','Mechanical','Electrical','Trial','Ready')),

  -- SEND side
  sent_by                   uuid         NOT NULL
                                         REFERENCES auth.users(id) ON DELETE RESTRICT,
  sent_by_signature_id      bigint       REFERENCES public.employee_signatures(id),
  sent_at                   timestamptz  NOT NULL DEFAULT now(),
  expected_duration_minutes integer      NOT NULL,
  actual_duration_minutes   integer      NOT NULL,
  overrun_minutes           integer      GENERATED ALWAYS AS
                             (GREATEST(0, actual_duration_minutes - expected_duration_minutes))
                             STORED,
  overrun_narration         text,

  -- ACCEPT side (nullable until accepted)
  accepted_by               uuid         REFERENCES auth.users(id) ON DELETE RESTRICT,
  accepted_by_signature_id  bigint       REFERENCES public.employee_signatures(id),
  accepted_at               timestamptz,

  -- 'held' is NEVER written by Phase A code — HOLD is a derived UI state.
  status                    text         NOT NULL DEFAULT 'pending'
                                         CHECK (status IN ('pending','accepted','cancelled')),

  cancelled_at              timestamptz,
  cancellation_reason       text,

  accept_timeout_minutes    integer      NOT NULL,  -- snapshot of settings at send time
  created_at                timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT handover_dept_different       CHECK (from_department IS DISTINCT FROM to_department),
  CONSTRAINT handover_narration_when_over  CHECK (overrun_minutes = 0 OR
                                                   (overrun_narration IS NOT NULL
                                                    AND length(trim(overrun_narration)) > 0)),
  CONSTRAINT handover_accept_fields_pair   CHECK (
    (status = 'accepted' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL)
     OR
    (status <> 'accepted' AND accepted_by IS NULL AND accepted_at IS NULL)
  ),
  CONSTRAINT handover_cancel_fields_pair   CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL)
     OR
    (status <> 'cancelled' AND cancelled_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS handover_events_machine_idx
  ON public.handover_events (machine_id);
CREATE INDEX IF NOT EXISTS handover_events_status_idx
  ON public.handover_events (status);
CREATE INDEX IF NOT EXISTS handover_events_pending_timeout_idx
  ON public.handover_events (sent_at) WHERE status = 'pending';

ALTER TABLE public.handover_events ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read (Audit Trail needs cross-dept visibility).
DROP POLICY IF EXISTS handover_events_select_authenticated ON public.handover_events;
CREATE POLICY handover_events_select_authenticated ON public.handover_events
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: only as yourself. Dept-role check is enforced client-side via
-- canDo("machines","finishTransfer") because roles are not dept-tagged in
-- the current schema (same approach as existing machines.updateStage).
DROP POLICY IF EXISTS handover_events_insert_sender ON public.handover_events;
CREATE POLICY handover_events_insert_sender ON public.handover_events
  FOR INSERT TO authenticated
  WITH CHECK (sent_by = auth.uid());

-- UPDATE: only when still pending, and the acceptor is the current user,
-- OR when the sender cancels. Second accept gets zero rows affected (atomic).
DROP POLICY IF EXISTS handover_events_accept ON public.handover_events;
CREATE POLICY handover_events_accept ON public.handover_events
  FOR UPDATE TO authenticated
  USING (status = 'pending')
  WITH CHECK (
       (status = 'accepted' AND accepted_by = auth.uid())
    OR (status = 'cancelled' AND sent_by    = auth.uid())
  );

-- DELETE: no policy, default deny. CASCADE from machine_log is the only path.

-- ─── 3. machine_log extensions ──────────────────────────────────────────────
-- current_department mirrors stage. department_entered_at starts the clock
-- for overrun computation. pending_handover_id lets us render Accept/HOLD
-- without a per-row join against handover_events.

ALTER TABLE public.machine_log
  ADD COLUMN IF NOT EXISTS current_department    text,
  ADD COLUMN IF NOT EXISTS department_entered_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_handover_id   bigint
                             REFERENCES public.handover_events(id)
                             ON DELETE SET NULL;

-- Backfill existing rows: adopt current stage as current_department, derive
-- entry time from the newest history entry (or fall back to created_date,
-- then created_at). Idempotent via the IS NULL guard.
UPDATE public.machine_log
   SET current_department    = stage,
       department_entered_at = COALESCE(
         (SELECT (h->>'date')::timestamptz
            FROM jsonb_array_elements(history) h
           WHERE (h->>'date') IS NOT NULL
             AND (h->>'date') ~ '^\d{4}-\d{2}-\d{2}'
           ORDER BY (h->>'date')::timestamptz DESC
           LIMIT 1),
         created_date::timestamptz,
         created_at
       )
 WHERE current_department IS NULL;

CREATE INDEX IF NOT EXISTS machine_log_pending_handover_idx
  ON public.machine_log (pending_handover_id)
  WHERE pending_handover_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS machine_log_current_department_idx
  ON public.machine_log (current_department);

-- ─── 4. Audit event-type documentation (comment-only) ───────────────────────
-- audit_log already exists (migration 004). Phase A will emit the following
-- new type values via existing INSERTs — no schema change:
--   handover_sent              — on handover_events INSERT
--   handover_accepted          — on handover_events UPDATE to status='accepted'
--   handover_overrun_narrated  — accompanying handover_sent when overrun > 0
--   signature_registered       — on employee_signatures INSERT or UPDATE

COMMIT;
