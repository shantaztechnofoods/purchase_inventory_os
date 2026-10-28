-- ─────────────────────────────────────────────────────────────────────────────
-- 033_pending_item_assigned_department_rollback.sql
-- Reverses 033. Dropping the column discards every assignment recorded since
-- the migration ran — only run this if the feature is being abandoned.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP INDEX IF EXISTS public.pending_handover_items_assigned_open_idx;

ALTER TABLE public.pending_handover_items
  DROP COLUMN IF EXISTS assigned_department;

COMMIT;
