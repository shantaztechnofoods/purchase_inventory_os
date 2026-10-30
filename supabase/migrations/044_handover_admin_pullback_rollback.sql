-- Rollback for 044_handover_admin_pullback.sql: removes only the added policy.
BEGIN;
DROP POLICY IF EXISTS handover_events_admin_cancel ON public.handover_events;
COMMIT;
