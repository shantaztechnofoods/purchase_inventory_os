-- ─────────────────────────────────────────────────────────────────────────────
-- 045_machine_rack_slot.sql — which fixed rack slot a machine occupies
--
-- Brief §14 (2026-10-31): every rack slot has its own status and actions, so
-- a machine must remember the exact slot its BOM set was put in — from BOM
-- Outward (Save To Rack / Fill) through Assembly until the production head
-- releases it to Mechanical, when the slot becomes Empty again.
--
-- Slot ids are "<tier>-<family>-<column>#<position>", e.g. "M-10-1#2". The
-- layout itself is fixed in the app (src/utils/rackSlots.js); nothing here
-- creates racks.
--
-- Additive, nullable. Legacy rows (NULL) keep today's behaviour: they are
-- placed into free slots oldest-first. No RLS change (CLAUDE.md §5) — the
-- column is written through the existing machine_log update policies.
-- Rollback: 045_machine_rack_slot_rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE public.machine_log
  ADD COLUMN IF NOT EXISTS rack_slot text;

COMMENT ON COLUMN public.machine_log.rack_slot IS
  'Fixed rack slot the machine occupies ("M-10-1#2"), from Save To Rack until release to Mechanical. NULL = not on a rack / legacy row (auto-placed).';

CREATE INDEX IF NOT EXISTS machine_log_rack_slot_idx
  ON public.machine_log (rack_slot)
  WHERE rack_slot IS NOT NULL;

COMMIT;
