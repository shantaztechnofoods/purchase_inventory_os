-- ════════════════════════════════════════════════════════════════════════════
-- 041 — Department durations configured on the BOM
-- ════════════════════════════════════════════════════════════════════════════
--
-- Why: deadlines per department were only a global default (settings) that the
-- store operator was asked to confirm or edit at every BOM Outward. The durations
-- belong to the model: set once on the BOM, copied onto each machine at Outward
-- (machine_log.dept_durations, migration 027) without asking again.
--
--   dept_durations : { "Assembly": {"minutes": 1440}, "Mechanical": {...},
--                      "Electrical": {...}, "Trial": {...} }
--
-- NULL = not configured for this BOM → Outward behaves exactly as before
-- (global defaults, popup shown). Additive; no backfill.
-- Rollback: 041_bom_dept_durations_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.bom_definitions
  ADD COLUMN IF NOT EXISTS dept_durations jsonb;

COMMENT ON COLUMN public.bom_definitions.dept_durations IS
  'Per-department deadline minutes for machines of this model: {Dept:{minutes}}. Copied to machine_log.dept_durations at BOM Outward. NULL = use global settings.';

COMMIT;
