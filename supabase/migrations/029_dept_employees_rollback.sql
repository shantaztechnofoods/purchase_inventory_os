-- Rollback for 029_dept_employees.sql — reverses column + index additions.

BEGIN;

DROP INDEX IF EXISTS public.handover_events_worked_by_gin_idx;

ALTER TABLE public.handover_events
  DROP CONSTRAINT IF EXISTS handover_main_in_worked;

ALTER TABLE public.handover_events
  DROP COLUMN IF EXISTS main_employee_signature_svg,
  DROP COLUMN IF EXISTS main_employee_signature_id,
  DROP COLUMN IF EXISTS main_employee_id,
  DROP COLUMN IF EXISTS worked_by_snapshot,
  DROP COLUMN IF EXISTS worked_by;

DROP INDEX IF EXISTS public.users_departments_gin_idx;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS departments;

COMMIT;
