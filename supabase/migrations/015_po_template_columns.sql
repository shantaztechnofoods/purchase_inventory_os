-- ─────────────────────────────────────────────────────────────────────────────
-- 015_po_template_columns.sql — per-PO company profile + template selection
--
-- Adds two optional columns to purchase_orders so each PO can remember which
-- company profile issued it and which template to render. Additive + idempotent;
-- safe to run anytime. The app (posStore.createPO) is schema-tolerant and will
-- still create POs if this migration hasn't been run yet — running it simply makes
-- the per-PO company/template choice persist across reloads.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS company_id text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS template   text;

COMMENT ON COLUMN public.purchase_orders.company_id IS 'PO Settings company profile id (settings.po.companies[].id) that issued this PO.';
COMMENT ON COLUMN public.purchase_orders.template   IS 'PO template preset id (default/A/B/C) used for this PO''s PDF.';
