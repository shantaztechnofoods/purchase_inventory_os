-- ─────────────────────────────────────────────────────────────────────────────
-- 036_rack_release_and_hold.sql
-- Two things the shop floor does that the app had no way to record.
--
RELEASE FROM THE RACK
--    Shantaz runs a pull system, not a push one. Assembly takes material off
--    the rack, assembles it, and puts the machine BACK on the rack — seven or
--    eight sit there at a time. Mechanical does not start on one until the
--    production head says so.
--
--    The app modelled a push: Finish & Transfer created a handover that the
--    receiving department had to accept within the 2-hour acceptance window,
--    or the machine showed as OVERDUE. A machine waiting on the rack for two
--    days is normal here, so that alarm was simply wrong.
--
--    A handover may now be marked release_required. Until a production head
--    releases it, the machine sits on the rack, the acceptance clock does not
--    run, and the receiving department does not see it. On release it enters
--    that department's "Take in" list and the normal flow resumes — checklist,
--    signature, ratings, timings, all unchanged.
--
-- HOLD is deliberately NOT stored. It is not a button someone presses: a
-- handover is "on hold" when the receiving department has not accepted it
-- within its acceptance window, and that is fully derivable from sent_at,
-- accepted_at and accept_timeout_minutes, which are already recorded. Storing
-- it would only create a second version of the truth that could drift.
--
-- Additive and nullable throughout; no RLS policy touched (CLAUDE.md §5).
-- Existing rows behave exactly as before: release_required defaults false, so
-- every handover already in flight stays a straight push.
--
-- Depends on: 021 (handover_events)
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Release from the rack ────────────────────────────────────────────────
ALTER TABLE public.handover_events
  ADD COLUMN IF NOT EXISTS release_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS released_at      timestamptz,
  ADD COLUMN IF NOT EXISTS released_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.handover_events.release_required IS
  'true when the machine waits on the rack until a production head releases it. The acceptance clock does not run while released_at is null.';

-- The query that matters: handovers parked on the rack awaiting a release.
CREATE INDEX IF NOT EXISTS handover_events_awaiting_release_idx
  ON public.handover_events (to_department)
  WHERE status = 'pending' AND release_required = true AND released_at IS NULL;

COMMIT;
