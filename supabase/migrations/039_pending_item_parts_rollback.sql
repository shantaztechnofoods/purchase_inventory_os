-- Rollback for 039_pending_item_parts.sql. Drops only the columns 039 added.
-- Run 040_pending_item_policies_rollback.sql FIRST (its policy references
-- received_at / received_by).
BEGIN;
DROP INDEX IF EXISTS public.pending_handover_items_open_item_idx;
ALTER TABLE public.pending_handover_items
  DROP COLUMN IF EXISTS item_code,
  DROP COLUMN IF EXISTS item_name,
  DROP COLUMN IF EXISTS qty,
  DROP COLUMN IF EXISTS reason,
  DROP COLUMN IF EXISTS received_at,
  DROP COLUMN IF EXISTS received_by,
  DROP COLUMN IF EXISTS received_notes;
COMMIT;
