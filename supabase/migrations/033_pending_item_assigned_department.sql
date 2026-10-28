-- ─────────────────────────────────────────────────────────────────────────────
-- 033_pending_item_assigned_department.sql
-- Phase 1 (Machine Tracker) — route a pending item to the department that has
-- to come and fix it.
--
-- Why: `raised_in_department` records the department the issue is BLAMED on at
-- Accept time (the sender). It does not say who must act, and it cannot be set
-- when Trial finds a fault mid-work that belongs to a department two steps
-- back. Shantaz's real process is: Trial inspects, finds a fault, calls the
-- responsible department, that department comes to the machine and fixes it —
-- the machine itself never moves backwards.
--
-- Additive only. Nullable, no default, no backfill: every existing row keeps
-- working and simply has no assignment. No RLS policy is touched (per
-- CLAUDE.md §5 — policy changes get their own reviewed PR).
--
-- Depends on: 023_pending_handover_items.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.pending_handover_items
  ADD COLUMN IF NOT EXISTS assigned_department text;

COMMENT ON COLUMN public.pending_handover_items.assigned_department IS
  'Department that must come and fix this item. NULL for pre-033 rows and for items raised without an assignment.';

-- Partial index: the only query that matters is "open items for department X".
CREATE INDEX IF NOT EXISTS pending_handover_items_assigned_open_idx
  ON public.pending_handover_items (assigned_department)
  WHERE status = 'open';

COMMIT;
