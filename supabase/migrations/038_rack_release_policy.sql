-- ════════════════════════════════════════════════════════════════════════════
-- 038 — Let a production head release a machine from the rack
-- ════════════════════════════════════════════════════════════════════════════
--
-- Why: migration 036 added released_at / released_by to handover_events but no
-- UPDATE policy that allows setting them. The only UPDATE policy on the table
-- (handover_events_accept, migration 021) accepts a new row only when its
-- status becomes 'accepted' or 'cancelled'. A release keeps status 'pending',
-- so Postgres rejected every release with:
--
--   42501  new row violates row-level security policy for table "handover_events"
--
-- Effect in production: every machine that finished Assembly stayed "On rack ·
-- assembled" for good — the "Send to Mechanical" button could never succeed.
-- Found 2026-10-30 running KM10-001 end to end on the live ERP.
--
-- What this allows, and nothing more: an authenticated user may stamp
-- released_at / released_by on a handover that is still pending, still
-- requires release, and has not been released yet — and only as themselves.
-- Status cannot change through this policy. Who may release is still enforced
-- in the app by canDo("machines", "release"), the same split migration 021
-- uses for Finish & Transfer.
--
-- Additive: no existing policy is changed or dropped. Rollback:
-- 038_rack_release_policy_rollback.sql.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS handover_events_release ON public.handover_events;
CREATE POLICY handover_events_release ON public.handover_events
  FOR UPDATE TO authenticated
  USING (
        status = 'pending'
    AND release_required = true
    AND released_at IS NULL
  )
  WITH CHECK (
        status = 'pending'
    AND release_required = true
    AND released_at IS NOT NULL
    AND released_by = auth.uid()
  );

COMMIT;
