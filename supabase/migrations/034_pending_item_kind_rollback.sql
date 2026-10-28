-- ─────────────────────────────────────────────────────────────────────────────
-- 034_pending_item_kind_rollback.sql
-- Reverses 034. Every item becomes a plain pending item again, so the
-- Ready-blocking rule stops applying. Only run this if the feature is being
-- abandoned.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP INDEX IF EXISTS public.pending_handover_items_kind_open_idx;

ALTER TABLE public.pending_handover_items
  DROP CONSTRAINT IF EXISTS pending_item_kind_check;

ALTER TABLE public.pending_handover_items
  DROP COLUMN IF EXISTS kind;

COMMIT;
