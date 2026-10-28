-- ─────────────────────────────────────────────────────────────────────────────
-- 035_role_machine_permissions_rollback.sql
-- Restores the exact role state captured from production before 035 ran
-- (2026-10-28). Running this puts the handover flow back to super-admin-only,
-- so only use it if 035 caused a problem.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

UPDATE public.roles
   SET actions = jsonb_set(actions, '{machines}', '{"updateStage": true}'::jsonb)
 WHERE key = 'Admin';

UPDATE public.roles
   SET actions = jsonb_set(actions, '{machines}', '{"updateStage": true}'::jsonb),
       pages   = '["dashboard","inventory","outward","pending","machines","history"]'::jsonb
 WHERE key = 'Production';

UPDATE public.roles
   SET actions = jsonb_set(actions, '{machines}', '{"updateStage": true}'::jsonb)
 WHERE key = 'Store Manager';

UPDATE public.roles
   SET actions = jsonb_set(actions, '{machines}', '{"updateStage": false}'::jsonb)
 WHERE key = 'Purchase Manager';

COMMIT;
