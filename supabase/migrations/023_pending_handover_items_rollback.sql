-- 023_pending_handover_items_rollback.sql
BEGIN;
DROP TABLE IF EXISTS public.pending_handover_items;
COMMIT;
