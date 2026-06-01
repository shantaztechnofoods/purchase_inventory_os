-- ─────────────────────────────────────────────────────────────────────────────
-- 018_po_gst_and_item_gst_rate.sql — ERP/Busy-style PO upgrade
--
-- Adds the columns the new PO modal writes to. All additive + idempotent so
-- a partial schema doesn't break re-runs.
--
-- purchase_orders:
--   purchase_type  text     — e.g. "local_gst_18", "inter_gst_5", "import_purchase"
--                              (see src/utils/gst.js PURCHASE_TYPES — single
--                              source of truth, this column just stores the key)
--   gst_type       text     — "local" | "interstate" | "import" | "zero" | "exempt"
--                              (denormalised from purchase_type so reports can
--                              filter without re-decoding the key)
--   po_date        date     — explicit PO date. Pre-018 POs only had `date`
--                              (created_at semantics). The app code falls back
--                              to date when po_date is NULL.
--   cgst, sgst, igst numeric — split tax. `gst` (the old single column) is kept
--                              as the sum for backwards compatibility.
--
-- items:
--   gst_rate numeric — per-item GST rate (0 / 5 / 12 / 18 / 28). Used by the
--                       auto GST calculator when the chosen Purchase Type is
--                       multi-rate or itemwise. NULL = not configured yet.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS purchase_type text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS gst_type      text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS po_date       date;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS cgst          numeric;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS sgst          numeric;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS igst          numeric;

-- Backfill po_date from the existing date column so existing PO history reads
-- correctly without conditional code paths.
UPDATE public.purchase_orders SET po_date = date WHERE po_date IS NULL AND date IS NOT NULL;

CREATE INDEX IF NOT EXISTS purchase_orders_purchase_type_idx ON public.purchase_orders(purchase_type);
CREATE INDEX IF NOT EXISTS purchase_orders_po_date_idx       ON public.purchase_orders(po_date DESC);

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS gst_rate numeric;

-- Range check so a typo can't slip through. NULL allowed (unset).
ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_gst_rate_chk;
ALTER TABLE public.items ADD CONSTRAINT items_gst_rate_chk
  CHECK (gst_rate IS NULL OR gst_rate IN (0, 5, 12, 18, 28));

COMMENT ON COLUMN public.purchase_orders.purchase_type IS 'Operator-chosen GST class — key from src/utils/gst.js PURCHASE_TYPES.';
COMMENT ON COLUMN public.purchase_orders.gst_type      IS 'Denormalised tax regime: local | interstate | import | zero | exempt.';
COMMENT ON COLUMN public.purchase_orders.po_date       IS 'Explicit PO date — independent of created_at. Falls back to date for pre-018 rows.';
COMMENT ON COLUMN public.purchase_orders.cgst          IS 'CGST amount — populated for local purchases. Sum of cgst+sgst+igst === gst.';
COMMENT ON COLUMN public.purchase_orders.sgst          IS 'SGST amount — populated for local purchases.';
COMMENT ON COLUMN public.purchase_orders.igst          IS 'IGST amount — populated for interstate / import purchases.';
COMMENT ON COLUMN public.items.gst_rate                IS 'Per-item GST rate (0|5|12|18|28). Used when Purchase Type is multi-rate / itemwise.';
