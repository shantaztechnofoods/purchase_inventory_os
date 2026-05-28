-- ─────────────────────────────────────────────────────────────────────────────
-- 011_inventory_engine_items.sql — extend items for the production inventory engine
--
-- Existing columns reused (NOT renamed, to avoid breaking the app):
--   stock              → current_stock (physical on-hand)
--   min_stock          → minimum_stock
--   last_purchase_rate → last_purchase_rate
--
-- New columns:
--   reserved_stock   → qty committed to orders but not yet issued
--   reorder_level    → threshold that triggers a reorder suggestion
--   available_stock  → GENERATED (stock - reserved_stock), always in sync, read-only
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS reserved_stock numeric NOT NULL DEFAULT 0;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS reorder_level  numeric NOT NULL DEFAULT 0;

-- available_stock is a STORED generated column — Postgres keeps it in sync automatically
-- and rejects any direct write to it. This is the single source of truth for "what can I use".
DO $gen$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'available_stock'
  ) THEN
    ALTER TABLE public.items
      ADD COLUMN available_stock numeric
      GENERATED ALWAYS AS (stock - reserved_stock) STORED;
  END IF;
END
$gen$;

CREATE INDEX IF NOT EXISTS items_reorder_level_idx  ON public.items(reorder_level);
CREATE INDEX IF NOT EXISTS items_available_idx       ON public.items(available_stock);

COMMENT ON COLUMN public.items.stock           IS 'current_stock — physical on-hand quantity';
COMMENT ON COLUMN public.items.reserved_stock  IS 'Qty committed (e.g. to orders) but not yet physically issued';
COMMENT ON COLUMN public.items.available_stock IS 'GENERATED: stock - reserved_stock. Read-only — never write directly.';
COMMENT ON COLUMN public.items.reorder_level   IS 'When available_stock drops to/below this, item should be reordered';
