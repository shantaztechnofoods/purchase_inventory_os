-- Rollback for 038_rack_release_policy.sql.
-- Removes only the release policy; every other handover_events policy is left
-- as it was. After this, releasing a machine from the rack fails again.
BEGIN;
DROP POLICY IF EXISTS handover_events_release ON public.handover_events;
COMMIT;
