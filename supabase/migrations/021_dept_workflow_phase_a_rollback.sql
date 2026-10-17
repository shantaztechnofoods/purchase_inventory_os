-- ─────────────────────────────────────────────────────────────────────────────
-- 021_dept_workflow_phase_a_rollback.sql
--
-- Apply ONLY when reverting to pre-Phase-A code. Drops the three new columns
-- on machine_log and the two new tables. machine_log.history (jsonb) is
-- preserved — the Phase A code also mirrors handover entries into history, so
-- rollback keeps a legible audit trail even after this script runs.
--
-- settings.department_workflow is a JSONB key inside the single-row settings
-- payload. This script leaves it in place (unused keys are harmless). Delete
-- explicitly if desired:
--   UPDATE public.settings SET value = value - 'department_workflow';
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.machine_log
  DROP COLUMN IF EXISTS pending_handover_id,
  DROP COLUMN IF EXISTS department_entered_at,
  DROP COLUMN IF EXISTS current_department;

DROP TABLE IF EXISTS public.handover_events;
DROP TABLE IF EXISTS public.employee_signatures;

COMMIT;
