-- Rollback for 043_pending_item_receive_department.sql.
-- Restores the 042 trigger function exactly, then drops the 043 column.
-- (Any receive department already recorded is lost; the receipt itself —
-- received_at / received_by / received_notes — is kept.)
BEGIN;

CREATE OR REPLACE FUNCTION public.pending_handover_items_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  receive_keys  text[] := ARRAY['received_at','received_by','received_notes'];
  complete_keys text[] := ARRAY['status','resolved_at','resolved_by','resolved_in_department','resolution_notes'];
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Pending jobs cannot be deleted.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'resolved' THEN
    RAISE EXCEPTION 'This pending job is already completed and cannot be changed or reopened.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'open' AND NEW.status = 'open' THEN
    IF OLD.received_at IS NOT NULL THEN
      RAISE EXCEPTION 'This part is already recorded as received.' USING ERRCODE = '42501';
    END IF;
    IF NEW.received_at IS NULL THEN
      RAISE EXCEPTION 'An open pending job can only be updated to record the part as received.' USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) - receive_keys) IS DISTINCT FROM (to_jsonb(OLD) - receive_keys) THEN
      RAISE EXCEPTION 'Only the receipt can be recorded here — description, part, quantity, reason and other details cannot be changed.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'open' AND NEW.status = 'resolved' THEN
    IF (to_jsonb(NEW) - complete_keys) IS DISTINCT FROM (to_jsonb(OLD) - complete_keys) THEN
      RAISE EXCEPTION 'Completing a job cannot change its description, part, quantity, reason or receipt.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'This status change is not allowed for pending jobs.' USING ERRCODE = '42501';
END;
$$;

ALTER TABLE public.pending_handover_items DROP COLUMN IF EXISTS received_in_department;

COMMIT;
