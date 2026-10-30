-- ════════════════════════════════════════════════════════════════════════════
-- 042 — Guard updates on pending jobs: receive once, complete as before
-- ════════════════════════════════════════════════════════════════════════════
--
-- Why: Postgres ORs permissive policies of the same command. A row passes the
-- USING of pending_handover_items_resolve (023: status = 'open') and the new
-- row passes the WITH CHECK of pending_handover_items_receive (040: still open,
-- received_at set, received_by = me). Together they let any user with
-- machines.finishTransfer re-"receive" an open job again and again, and change
-- its description / part / qty / reason while doing it. RLS cannot compare old
-- and new values, so this trigger does.
--
-- Rules, for app users (roles authenticated / anon — what PostgREST runs as).
-- The postgres / service roles used for maintenance are not affected.
--   UPDATE of a completed job (status 'resolved')        → refused (no edit, no reopen)
--   UPDATE that keeps the job open  = "Part received"    → allowed once only:
--       OLD.received_at must be NULL, NEW.received_at set,
--       and nothing but received_at / received_by / received_notes may change
--   UPDATE open → resolved          = "Work completed"   → allowed, exactly as the
--       app does it today: only status / resolved_at / resolved_by /
--       resolved_in_department / resolution_notes may change. Who may do it
--       is still decided by the 023 resolve policy (unchanged).
--   any other status change                               → refused
--   DELETE                                                → refused (there was
--       already no DELETE policy; this states it at the row level too)
--
-- Additive: no column, policy or row is changed. Rollback:
-- 042_pending_item_update_guard_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

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
    -- "Work completed": exactly the fields the app sets.
    IF (to_jsonb(NEW) - complete_keys) IS DISTINCT FROM (to_jsonb(OLD) - complete_keys) THEN
      RAISE EXCEPTION 'Completing a job cannot change its description, part, quantity, reason or receipt.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'This status change is not allowed for pending jobs.' USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION public.pending_handover_items_guard() IS
  'Migration 042: app users may receive an open job once (receive fields only) or complete it (resolve fields only); no edits, reopening or deletes.';

DROP TRIGGER IF EXISTS pending_handover_items_guard ON public.pending_handover_items;
CREATE TRIGGER pending_handover_items_guard
  BEFORE UPDATE OR DELETE ON public.pending_handover_items
  FOR EACH ROW EXECUTE FUNCTION public.pending_handover_items_guard();

COMMIT;
