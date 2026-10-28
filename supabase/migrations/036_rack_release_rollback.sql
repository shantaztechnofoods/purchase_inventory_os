-- ─────────────────────────────────────────────────────────────────────────────
-- 036_rack_release_and_hold_rollback.sql
-- Reverses 036. Any machine currently parked on the rack awaiting release
-- becomes an ordinary pending handover again and its acceptance clock starts
-- running, so check for those before running this.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP INDEX IF EXISTS public.handover_events_awaiting_release_idx;

ALTER TABLE public.handover_events
  DROP COLUMN IF EXISTS release_required,
  DROP COLUMN IF EXISTS released_at,
  DROP COLUMN IF EXISTS released_by;

COMMIT;
