-- Reverses 047. Data is untouched; the app's own checks remain.
BEGIN;
DROP TRIGGER IF EXISTS machine_log_rack_set_guard ON public.machine_log;
DROP FUNCTION IF EXISTS public.machine_log_rack_set_guard();
ALTER TABLE public.machine_log DROP CONSTRAINT IF EXISTS machine_log_rack_slot_is_set;
COMMIT;
