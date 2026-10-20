-- ─────────────────────────────────────────────────────────────────────────────
-- 026_items_critical.sql — Critical-item flag + outward input policy on items.
-- Depends on: 001 (public.items).
--
-- Adds two additive, nullable-defaulting columns:
--   is_critical          : boolean, default false. Marks items that must be
--                          explicitly confirmed on BOM Outward.
--   outward_input_type   : text, nullable, CHECK ('checkbox' | 'serial' | NULL).
--                          Only meaningful when is_critical = true; the UI
--                          enforces that invariant. 'checkbox' = operator must
--                          tick a confirmation; 'serial' = operator must enter
--                          one serial number per issued unit.
--
-- Strictly additive. Existing rows get is_critical=false (safe default: no
-- behavioural change on legacy items). No data touched; no destructive op.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS is_critical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS outward_input_type text
    CHECK (outward_input_type IN ('checkbox', 'serial') OR outward_input_type IS NULL);

-- Partial index: critical items are rare; keep the index tight so the common
-- "list all items" path isn't paying for a bloat index.
CREATE INDEX IF NOT EXISTS items_is_critical_idx
  ON public.items (is_critical) WHERE is_critical = true;

COMMIT;
