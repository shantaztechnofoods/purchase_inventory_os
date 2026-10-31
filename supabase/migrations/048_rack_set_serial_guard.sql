-- ─────────────────────────────────────────────────────────────────────────────
-- 048_rack_set_serial_guard.sql — the two sets of a model never share a serial
--
-- M-10 (1) + R-10 (1) is one machine (one machine_log row), so both racks show
-- the same serial by construction. M-10 (2) + R-10 (2) is a different machine
-- and must carry a different serial. 048 extends the 047 guard function: a
-- rack_slot write is also refused when another active rack machine of the
-- same model (10 / 15 / 20) already has that serial.
--
-- Replaces the function body only (trigger, CHECK and data unchanged).
-- No RLS change. Rollback: 048_rack_set_serial_guard_rollback.sql restores
-- the 047 function body.
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
  -- 048: the two sets of a model never share a serial number. The M and R
  -- racks of ONE set show the same serial because they hold ONE machine row;
  -- a second active rack machine of the same model with that serial is
  -- refused.
  IF coalesce(btrim(NEW.serial_no), '') <> '' THEN
    SELECT m.id, m.rack_slot INTO holder
      FROM public.machine_log m
     WHERE m.id IS DISTINCT FROM NEW.id
       AND m.rack_slot IS NOT NULL
       AND substring(m.rack_slot FROM '^[MR]-([0-9]+)-') = substring(NEW.rack_slot FROM '^[MR]-([0-9]+)-')
       AND lower(btrim(m.serial_no)) = lower(btrim(NEW.serial_no))
       AND m.status <> 'completed'
       AND m.stage IN ('BOM Issued', 'Assembly')
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Serial % is already used by machine % on rack set %', NEW.serial_no, holder.id, regexp_replace(holder.rack_slot, '^R-', 'M-')
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
