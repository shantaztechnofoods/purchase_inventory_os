-- ════════════════════════════════════════════════════════════════════════════
-- 039 — Pending jobs carry the missing part, and a "part received" step
-- ════════════════════════════════════════════════════════════════════════════
--
-- Why: a pending job on a machine was a free-text description only. The floor
-- needs to record WHICH part is missing (item code, name, quantity), WHY, and
-- then record that the part has arrived before the work is finished — so the
-- job's history reads reported → awaiting part/work → received → completed.
--
-- What this adds (all nullable, no backfill, no behaviour change for old rows):
--   item_code / item_name / qty  the missing part, when the job is a part
--   reason                        why it is pending (separate from description)
--   received_at / received_by /   the part-received step. A job with
--   received_notes                received_at set is still status 'open' —
--                                 'resolved' remains the single completion
--                                 state, so every existing query, index and
--                                 policy keeps working unchanged.
--
-- Additive. Rollback: 039_pending_item_parts_rollback.sql.
-- Policy for the receive step is a separate file: 040_pending_item_policies.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.pending_handover_items
  ADD COLUMN IF NOT EXISTS item_code      text,
  ADD COLUMN IF NOT EXISTS item_name      text,
  ADD COLUMN IF NOT EXISTS qty            numeric CHECK (qty IS NULL OR qty >= 0),
  ADD COLUMN IF NOT EXISTS reason         text,
  ADD COLUMN IF NOT EXISTS received_at    timestamptz,
  ADD COLUMN IF NOT EXISTS received_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_notes text;

COMMENT ON COLUMN public.pending_handover_items.item_code      IS 'Item Master code of the missing part, when the job is a part.';
COMMENT ON COLUMN public.pending_handover_items.qty            IS 'Quantity of the missing part still needed.';
COMMENT ON COLUMN public.pending_handover_items.reason         IS 'Why the work/part is pending (e.g. not in store, on order).';
COMMENT ON COLUMN public.pending_handover_items.received_at    IS 'Set when the responsible department records the part as received. Status stays open until the work is completed (resolved).';

CREATE INDEX IF NOT EXISTS pending_handover_items_open_item_idx
  ON public.pending_handover_items (item_code)
  WHERE status = 'open' AND item_code IS NOT NULL;

COMMIT;
