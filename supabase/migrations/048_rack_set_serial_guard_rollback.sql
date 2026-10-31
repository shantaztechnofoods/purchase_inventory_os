-- Reverses 048: restores the 047 guard function body (one machine per set).
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
  RETURN NEW;
END;
$$;

COMMIT;
