-- ════════════════════════════════════════════════════════════════════════════
-- 044 — Admin Pull Back: an admin may cancel a pending hand-over
-- ════════════════════════════════════════════════════════════════════════════
--
-- Migration 021's only UPDATE policy on handover_events lets the SENDER cancel
-- a pending hand-over. The agreed workflow also lets an admin pull a machine
-- back (e.g. sent to the wrong department, work not finished, stuck on hold)
-- whoever sent it. This ADDS one UPDATE policy for that; nothing existing is
-- changed. Status may only become 'cancelled'; the 021 check constraint still
-- requires cancelled_at to be set with it. Admin = machines.configDept, the
-- same gate the Machine Tracker settings use.
--
-- RLS-only, additive. Rollback: 044_handover_admin_pullback_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

DROP POLICY IF EXISTS handover_events_admin_cancel ON public.handover_events;
CREATE POLICY handover_events_admin_cancel ON public.handover_events
  FOR UPDATE TO authenticated
  USING (status = 'pending' AND public.has_permission('machines','configDept'))
  WITH CHECK (status = 'cancelled' AND public.has_permission('machines','configDept'));

COMMIT;
