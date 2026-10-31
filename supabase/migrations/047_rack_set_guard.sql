-- ─────────────────────────────────────────────────────────────────────────────
-- 047_rack_set_guard.sql — one machine per M/R rack set, in the database
--
-- 2026-10-31 M/R machine sets: M-10 (1) + R-10 (1) is ONE machine set (one
-- machine, one serial). A machine stores its set as rack_slot = the M slot id
-- ("M-10-1#1"); older rows may hold the R id of the same set ("R-10-1#1"),
-- which names the same set.
--
-- 1. CHECK: rack_slot is NULL or one of the twelve unit ids.
-- 2. TRIGGER: writing a rack_slot (insert, or update of rack_slot) is refused
--    while another active machine still holds the same set — stage BOM Issued
--    or Assembly, and its rack hand-over not yet released. A released
--    machine has physically left the rack even when its rack_slot could not
--    be cleared, so it does not block the set. An advisory lock per set
--    serialises two devices filling the same set at the same moment.
--
-- Additive only. No data is changed, no RLS policy is touched (CLAUDE.md §5).
-- The guard function is SECURITY DEFINER only so its read of machine_log /
-- handover_events sees every row regardless of the caller's RLS; it writes
-- nothing. Rollback: 047_rack_set_guard_rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE public.machine_log
  DROP CONSTRAINT IF EXISTS machine_log_rack_slot_is_set;
ALTER TABLE public.machine_log
  ADD CONSTRAINT machine_log_rack_slot_is_set
  CHECK (rack_slot IS NULL OR rack_slot ~ '^[MR]-(10|15|20)-1#[12]$') NOT VALID;
ALTER TABLE public.machine_log VALIDATE CONSTRAINT machine_log_rack_slot_is_set;

CREATE OR REPLACE FUNCTION public.machine_log_rack_set_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  set_slot text;
  holder   record;
BEGIN
  IF NEW.rack_slot IS NULL THEN RETURN NEW; END IF;
  IF NEW.status = 'completed' OR NEW.stage NOT IN ('BOM Issued', 'Assembly') THEN RETURN NEW; END IF;
  set_slot := regexp_replace(NEW.rack_slot, '^R-', 'M-');
  PERFORM pg_advisory_xact_lock(hashtext('machine_log.rack_set:' || set_slot));
  SELECT m.id, m.serial_no INTO holder
    FROM public.machine_log m
   WHERE m.id IS DISTINCT FROM NEW.id
     AND m.rack_slot IS NOT NULL
     AND regexp_replace(m.rack_slot, '^R-', 'M-') = set_slot
     AND m.status <> 'completed'
     AND m.stage IN ('BOM Issued', 'Assembly')
     AND NOT EXISTS (
       SELECT 1 FROM public.handover_events h
        WHERE h.machine_id = m.id
          AND h.release_required IS TRUE
          AND h.released_at IS NOT NULL
          AND h.status IS DISTINCT FROM 'cancelled')
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Rack set % already holds machine % (serial %)', set_slot, holder.id, coalesce(holder.serial_no, '—')
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.machine_log_rack_set_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS machine_log_rack_set_guard ON public.machine_log;
CREATE TRIGGER machine_log_rack_set_guard
  BEFORE INSERT OR UPDATE OF rack_slot ON public.machine_log
  FOR EACH ROW EXECUTE FUNCTION public.machine_log_rack_set_guard();

COMMENT ON FUNCTION public.machine_log_rack_set_guard() IS
  'One machine per M/R rack set (M-xx-1#n + R-xx-1#n): refuses a rack_slot write while another active, unreleased machine holds the set. Migration 047.';

COMMIT;
