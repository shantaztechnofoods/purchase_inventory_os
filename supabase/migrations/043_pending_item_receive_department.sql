-- ════════════════════════════════════════════════════════════════════════════
-- 043 — Pending job history: record the department of the "Part received" entry
-- ════════════════════════════════════════════════════════════════════════════
--
-- A pending job keeps three separate, permanent history entries:
--   Reported       reason · raised_by · raised_in_department · raised_at        (023/039)
--   Part received  received_notes · received_by · received_in_department ·
--                  received_at                                                  (039 + this)
--   Completed      resolution_notes · resolved_by · resolved_in_department ·
--                  resolved_at                                                  (023)
-- Each lives in its own columns, so a later entry can never overwrite an
-- earlier one. Migration 042's trigger already makes them permanent: the
-- reported details are locked, the receipt can be written once, and a
-- completed job cannot be changed. This adds the one missing piece — which
-- department recorded the receipt — and lets the receive step write it.
--
-- 042 is already applied in production and is not edited; this replaces the
-- trigger function with the same rules plus the new receive column.
--
-- Additive: one nullable column, no backfill, no policy or row changed.
-- Rollback: 043_pending_item_receive_department_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.pending_handover_items
  ADD COLUMN IF NOT EXISTS received_in_department text;

COMMENT ON COLUMN public.pending_handover_items.received_in_department IS
  'Department that recorded the part as received (history entry 2 of 3).';

CREATE OR REPLACE FUNCTION public.pending_handover_items_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  receive_keys  text[] := ARRAY['received_at','received_by','received_notes','received_in_department'];
  complete_keys text[] := ARRAY['status','resolved_at','resolved_by','resolved_in_department','resolution_notes'];
BEGIN
  -- Maintenance roles (dashboard SQL, service role, migrations) are not app users.
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
    -- "Part received": once, and only the receive fields.
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
    -- "Work completed": exactly the fields the app sets. The reported reason
    -- and the receipt stay as they were.
    IF (to_jsonb(NEW) - complete_keys) IS DISTINCT FROM (to_jsonb(OLD) - complete_keys) THEN
      RAISE EXCEPTION 'Completing a job cannot change its description, part, quantity, reason or receipt.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'This status change is not allowed for pending jobs.' USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION public.pending_handover_items_guard() IS
  'Migrations 042/043: app users may receive an open job once (receive fields only) or complete it (resolve fields only); no edits, reopening or deletes.';

COMMIT;
