-- Reverses 050. Non-login Main Employee attribution is lost from these columns
-- (the worked_by_snapshot still carries main:true).
BEGIN;
ALTER TABLE public.handover_events
  DROP COLUMN IF EXISTS main_employee_ref,
  DROP COLUMN IF EXISTS main_employee_name;
COMMIT;
