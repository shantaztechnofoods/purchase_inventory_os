-- Rollback for 042_pending_item_update_guard.sql. Removes only the trigger and
-- its function; every column, policy and row is left as it was.
BEGIN;
DROP TRIGGER IF EXISTS pending_handover_items_guard ON public.pending_handover_items;
DROP FUNCTION IF EXISTS public.pending_handover_items_guard();
COMMIT;
