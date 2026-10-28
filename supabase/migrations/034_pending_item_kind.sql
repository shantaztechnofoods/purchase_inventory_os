-- ─────────────────────────────────────────────────────────────────────────────
-- 034_pending_item_kind.sql
-- Phase 1 (Machine Tracker) — two different kinds of pending item, which must
-- block two different things.
--
-- 'fault'  A department found something wrong and called the department
--          responsible to come to the machine. The machine does NOT move:
--          Finish & Transfer stays blocked until it is resolved. (033 flow.)
--
-- 'owed'   A department finished and handed the machine on, but still owes
--          work on it — typically a part that has been ordered and has not
--          arrived. Holding the machine would stall the whole line, so it
--          moves on; the obligation follows it. The machine may NOT reach
--          Ready while any 'owed' item is open, so an incomplete machine is
--          never presented as ready for delivery.
--
-- Existing rows were all raised as faults, so 'fault' is the default and the
-- backfill is a no-op. Additive; no RLS policy touched (CLAUDE.md §5).
--
-- Depends on: 023_pending_handover_items.sql, 033_pending_item_assigned_department.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.pending_handover_items
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'fault';

-- Added separately and guarded so re-running the file is safe.
ALTER TABLE public.pending_handover_items
  DROP CONSTRAINT IF EXISTS pending_item_kind_check;
ALTER TABLE public.pending_handover_items
  ADD CONSTRAINT pending_item_kind_check CHECK (kind IN ('fault', 'owed'));

COMMENT ON COLUMN public.pending_handover_items.kind IS
  'fault = machine is held until fixed; owed = machine moves on but cannot reach Ready until done.';

-- The two queries that matter: open faults on a machine (blocks transfer) and
-- open owed items on a machine (blocks Ready).
CREATE INDEX IF NOT EXISTS pending_handover_items_kind_open_idx
  ON public.pending_handover_items (machine_id, kind)
  WHERE status = 'open';

COMMIT;
