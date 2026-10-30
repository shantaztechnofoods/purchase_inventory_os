-- 037 — Per-item check points
--
-- Store-floor instructions an operator must verify for a given item at BOM
-- Outward time ("Handle with care", "Check shaft diameter", …).
--
-- This column is the TEMPLATE. When an item is selected into a BOM, the BOM
-- line inherits a COPY of these strings into bom_definitions.items[].checkPoints
-- (already jsonb — no migration needed there), so the same item can carry
-- different check points in KM10's BOM than in KM15's without the item row
-- changing. Editing the item template never rewrites existing BOM lines.
--
-- Additive and nullable: pre-037 rows read back as an empty list, and the
-- client strips this column on a schema miss (itemsStore.isMissingColumnError),
-- so deploying the app before this migration is safe.

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS check_points jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.items.check_points IS
  'Template list of operator check-point strings for this item. BOM lines inherit a copy at selection time and may override per-BOM.';
