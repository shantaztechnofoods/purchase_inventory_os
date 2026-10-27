-- Migration 031 — accepted_by_team_snapshot on handover_events
-- Additive: nullable JSONB column stores the list of team members (display names)
-- who were present when a receiving department accepted a handover.
-- These are typically factory workers without ERP logins, managed in Settings → Employees.
-- Nullable for all legacy rows; the accept flow still works without this column
-- (store retries without it when schema isn't migrated yet).

ALTER TABLE public.handover_events
  ADD COLUMN IF NOT EXISTS accepted_by_team_snapshot jsonb;

COMMENT ON COLUMN public.handover_events.accepted_by_team_snapshot IS
  'Optional array of { name: string } for team members present at acceptance. Managed via Settings → Employees.';
