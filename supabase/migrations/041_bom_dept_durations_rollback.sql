-- Rollback for 041_bom_dept_durations.sql.
BEGIN;
ALTER TABLE public.bom_definitions DROP COLUMN IF EXISTS dept_durations;
COMMIT;
