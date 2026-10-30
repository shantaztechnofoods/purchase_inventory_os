-- ════════════════════════════════════════════════════════════════════════════
-- 040 — RLS: record a part as received; raise a job from BOM Outward
-- ════════════════════════════════════════════════════════════════════════════
--
-- RLS-only migration, kept separate from 039 so it can be reviewed on its own.
-- No existing policy is changed or dropped; both policies below are ADDED and
-- Postgres ORs policies of the same command, so nothing that works today stops
-- working.
--
-- 1. pending_handover_items_receive (UPDATE)
--    Migration 023's only UPDATE policy allows open → resolved and nothing
--    else, so the new "part received" step (039: received_at) could not be
--    saved. This lets a user with finishTransfer permission stamp
--    received_at / received_by / received_notes on an open, not-yet-received
--    job, as themselves. Status cannot change through this policy.
--
-- 2. pending_handover_items_insert_outward (INSERT)
--    A critical item left unverified at BOM Outward is now raised as a pending
--    job against the new machine, by the store operator issuing the BOM. The
--    023 insert policy requires machines.accept, which store operators do not
--    have; this allows the insert for outward.bom holders, still only as
--    themselves.
--
-- Rollback: 040_pending_item_policies_rollback.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS pending_handover_items_receive ON public.pending_handover_items;
CREATE POLICY pending_handover_items_receive ON public.pending_handover_items
  FOR UPDATE TO authenticated
  USING (status = 'open' AND received_at IS NULL)
  WITH CHECK (
        status = 'open'
    AND received_at IS NOT NULL
    AND received_by = auth.uid()
    AND public.has_permission('machines','finishTransfer')
  );

DROP POLICY IF EXISTS pending_handover_items_insert_outward ON public.pending_handover_items;
CREATE POLICY pending_handover_items_insert_outward ON public.pending_handover_items
  FOR INSERT TO authenticated
  WITH CHECK (raised_by = auth.uid()
              AND public.has_permission('outward','bom'));

COMMIT;
