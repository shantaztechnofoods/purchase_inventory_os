-- Rollback for migration 032
ALTER TABLE public.machine_log
  DROP COLUMN IF EXISTS trial_certificate;
