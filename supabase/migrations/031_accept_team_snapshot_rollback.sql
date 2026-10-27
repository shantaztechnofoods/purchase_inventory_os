-- Rollback for migration 031
ALTER TABLE public.handover_events
  DROP COLUMN IF EXISTS accepted_by_team_snapshot;
