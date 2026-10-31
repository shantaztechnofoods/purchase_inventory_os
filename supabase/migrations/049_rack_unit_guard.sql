-- ─────────────────────────────────────────────────────────────────────────────
-- 049_rack_unit_guard.sql — every rack unit is independent
--
-- 2026-10-31: M and R BOM Outward are completely independent. Each of the 12
-- units (M-10 (1) … R-20 (2)) holds its own machine with its own serial; an
-- R unit is no longer read as part of the M unit above it. 049 replaces the
-- guard function body (047/048):
--   • one active, unreleased machine per UNIT (exact rack_slot);
--   • a serial is unique per rack model+tier (M-10, R-10, …).
-- Trigger, CHECK constraint and data are unchanged. No RLS change.
-- Rollback: 049_rack_unit_guard_rollback.sql restores the 048 function.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

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
  set_slot := NEW.rack_slot;
  PERFORM pg_advisory_xact_lock(hashtext('machine_log.rack_unit:' || set_slot));
  SELECT m.id, m.serial_no INTO holder
    FROM public.machine_log m
   WHERE m.id IS DISTINCT FROM NEW.id
     AND m.rack_slot IS NOT NULL
     AND m.rack_slot = set_slot
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
    RAISE EXCEPTION 'Rack unit % already holds machine % (serial %)', set_slot, holder.id, coalesce(holder.serial_no, '—')
      USING ERRCODE = 'unique_violation';
  END IF;
  -- 049: serials are unique per rack model+tier (M-10, R-10, …): the two
  -- M-10 units never share a serial, and an R unit's serial is entered
  -- separately and is not compared with the M units.
  IF coalesce(btrim(NEW.serial_no), '') <> '' THEN
    SELECT m.id, m.rack_slot INTO holder
      FROM public.machine_log m
     WHERE m.id IS DISTINCT FROM NEW.id
       AND m.rack_slot IS NOT NULL
       AND substring(m.rack_slot FROM '^([MR]-[0-9]+)-') = substring(NEW.rack_slot FROM '^([MR]-[0-9]+)-')
       AND lower(btrim(m.serial_no)) = lower(btrim(NEW.serial_no))
       AND m.status <> 'completed'
       AND m.stage IN ('BOM Issued', 'Assembly')
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Serial % is already used by machine % on rack %', NEW.serial_no, holder.id, holder.rack_slot
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
