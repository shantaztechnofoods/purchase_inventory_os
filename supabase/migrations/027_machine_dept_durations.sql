-- ─────────────────────────────────────────────────────────────────────────────
-- 027_machine_dept_durations.sql — Per-machine department duration overrides.
-- Depends on: 001 (public.machine_log).
--
-- Adds one additive, nullable jsonb column:
--   dept_durations : {
--                      "Assembly":   { "minutes": <int> },
--                      "Mechanical": { "minutes": <int> },
--                      "Electrical": { "minutes": <int> },
--                      "Trial":      { "minutes": <int> }
--                    }
--
-- Captured once at BOM Outward, right after the Critical Item popup. Serves
-- as the authoritative deadline for *that specific machine* in the Department
-- Workflow (Phase A). When this column is NULL (legacy rows / schema not yet
-- migrated), the UI falls back to settings.department_workflow.dept_durations
-- as before — no behavioural change for existing machines.
--
-- Strictly additive. Nullable. No destructive op; no RLS or trigger change.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.machine_log
  ADD COLUMN IF NOT EXISTS dept_durations jsonb;

COMMIT;
