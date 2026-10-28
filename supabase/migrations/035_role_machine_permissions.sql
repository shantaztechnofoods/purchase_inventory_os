-- ─────────────────────────────────────────────────────────────────────────────
-- 035_role_machine_permissions.sql
-- Grant the Phase-A machine permissions to the roles that need them.
--
-- WHY THIS IS NEEDED
-- The Phase A handover work (migration 021 onward) introduced three new
-- machine actions — finishTransfer, accept, configDept — and added them to
-- authStore.DEFAULT_ROLES. But DEFAULT_ROLES is only a fallback for a fresh
-- install; this database was seeded by 007_seed.sql before those actions
-- existed, and nothing ever backfilled them. resolveCanDo() treats a missing
-- action as denied (`?? false`), so on this database:
--
--   * NO role except super_admin can Finish & Transfer or Accept a handover.
--   * Every handover recorded so far was performed by the super admin.
--   * A department login created today would be able to do nothing at all.
--
-- WHAT THIS CHANGES
--   Admin            full machine control, including the updateStage escape hatch
--   Production       finishTransfer + accept; updateStage OFF; pages = machines only
--   Store Manager    finishTransfer + accept; updateStage OFF
--   Purchase Manager explicitly denied all four (it had no business with machines)
--
-- updateStage skips the whole handover chain — no handover row, no signature,
-- no checklist, no department rating — so it is an admin-only correction tool.
-- Finish & Transfer is the route a machine actually takes forward.
--
-- Production's pages are narrowed to the Machine Tracker: a department head's
-- job is on that screen, and purchase rates, vendors and stock valuation are
-- not theirs to see.
--
-- The custom role `mihir_guide` is deliberately left untouched.
--
-- Merges into the existing actions->'machines' object rather than replacing
-- it, so any key not named here survives. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

UPDATE public.roles
   SET actions = jsonb_set(actions, '{machines}',
         COALESCE(actions->'machines', '{}'::jsonb)
         || '{"updateStage": true, "finishTransfer": true, "accept": true, "configDept": true}'::jsonb)
 WHERE key = 'Admin';

UPDATE public.roles
   SET actions = jsonb_set(actions, '{machines}',
         COALESCE(actions->'machines', '{}'::jsonb)
         || '{"updateStage": false, "finishTransfer": true, "accept": true, "configDept": false}'::jsonb),
       pages = '["machines"]'::jsonb
 WHERE key = 'Production';

UPDATE public.roles
   SET actions = jsonb_set(actions, '{machines}',
         COALESCE(actions->'machines', '{}'::jsonb)
         || '{"updateStage": false, "finishTransfer": true, "accept": true, "configDept": false}'::jsonb)
 WHERE key = 'Store Manager';

UPDATE public.roles
   SET actions = jsonb_set(actions, '{machines}',
         COALESCE(actions->'machines', '{}'::jsonb)
         || '{"updateStage": false, "finishTransfer": false, "accept": false, "configDept": false}'::jsonb)
 WHERE key = 'Purchase Manager';

COMMIT;
