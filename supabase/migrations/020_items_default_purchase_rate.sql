-- ─────────────────────────────────────────────────────────────────────────────
-- 020_items_default_purchase_rate.sql — operator-set fallback rate per item
--
-- Imported items often arrive with last_purchase_rate = 0 (the operator's
-- 2-column sheet doesn't carry rate at all). When a PO is created from such
-- an item, the line came out at ₹0 and the operator had to remember to fix
-- it every time.
--
-- This adds an explicit default rate that the operator sets once on the item
-- master. PO line creation now uses the fallback chain:
--   1. last_purchase_rate  (set by the most recent received PO)
--   2. default_purchase_rate (this column — the operator-curated baseline)
--   3. 0                     (true unknown)
--
-- Additive + idempotent. NULL allowed = not configured.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS default_purchase_rate numeric;

COMMENT ON COLUMN public.items.default_purchase_rate IS
  'Operator-set fallback rate. PO line creation prefers last_purchase_rate, then this, then 0.';
