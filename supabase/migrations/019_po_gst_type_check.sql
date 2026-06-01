-- ─────────────────────────────────────────────────────────────────────────────
-- 019_po_gst_type_check.sql — enforce gst_type vocabulary
--
-- Migration 018 added purchase_orders.gst_type as a free-form text column. The
-- app code only ever writes one of five values from utils/gst.js
-- (local | interstate | import | zero | exempt), but a bug elsewhere could
-- silently store "Local" or "LOCAL" or "local_gst" and break report filters.
-- This adds a CHECK constraint that catches the typo at write time.
--
-- Idempotent: DROPs the constraint first so re-running this migration is safe.
-- Safe to apply: 018 only writes the canonical lowercase values, so no
-- pre-existing row will violate the new constraint.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_gst_type_chk;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_gst_type_chk
  CHECK (gst_type IS NULL OR gst_type IN ('local', 'interstate', 'import', 'zero', 'exempt'));

COMMENT ON CONSTRAINT purchase_orders_gst_type_chk ON public.purchase_orders IS
  'Whitelist of GST regimes — must match utils/gst.js gstType field.';
