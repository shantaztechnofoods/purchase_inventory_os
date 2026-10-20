-- Rollback for 026_items_critical.sql — drops the two new item columns and the
-- partial index. Safe when no production code references the columns (i.e. the
-- client has also been rolled back).

BEGIN;

DROP INDEX IF EXISTS public.items_is_critical_idx;

ALTER TABLE public.items
  DROP COLUMN IF EXISTS outward_input_type,
  DROP COLUMN IF EXISTS is_critical;

COMMIT;
