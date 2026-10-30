-- Reverses 045. Slot memory is lost; the rack view falls back to placing
-- machines oldest-first, as before 045.
BEGIN;
DROP INDEX IF EXISTS public.machine_log_rack_slot_idx;
ALTER TABLE public.machine_log DROP COLUMN IF EXISTS rack_slot;
COMMIT;
