-- Rollback for 040_pending_item_policies.sql. Removes only the two policies
-- 040 added; the 023 policies are untouched.
BEGIN;
DROP POLICY IF EXISTS pending_handover_items_receive        ON public.pending_handover_items;
DROP POLICY IF EXISTS pending_handover_items_insert_outward ON public.pending_handover_items;
COMMIT;
