-- Rollback for 027_machine_dept_durations.sql — drops the dept_durations
-- jsonb column. Safe when the client no longer references it.

BEGIN;

ALTER TABLE public.machine_log
  DROP COLUMN IF EXISTS dept_durations;

COMMIT;
