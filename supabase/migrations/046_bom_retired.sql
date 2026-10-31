-- ─────────────────────────────────────────────────────────────────────────────
-- 046_bom_retired.sql — retire a BOM without deleting it
--
-- 2026-10-31: the fixed racks became six racks, one BOM each (M-10, R-10,
-- M-15, R-15, M-20, R-20). KM10 / KM15 / KM20 are replaced by M-10 / M-15 /
-- M-20. Their machines, outward log, pending rows and audit history keep the
-- old keys, so the old definitions must stay (labels, reports, history) but
-- can no longer be issued. These two nullable columns record that.
--
-- Additive, nullable; no RLS change (CLAUDE.md §5). Writes go through the
-- existing bom_definitions policies.
-- Rollback: 046_bom_retired_rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE public.bom_definitions
  ADD COLUMN IF NOT EXISTS retired_at  timestamptz,
  ADD COLUMN IF NOT EXISTS replaced_by text;

COMMENT ON COLUMN public.bom_definitions.retired_at  IS 'Set when the BOM may no longer be issued (kept for history). NULL = active.';
COMMENT ON COLUMN public.bom_definitions.replaced_by IS 'Key of the BOM that replaced this one, e.g. KM10 → M-10.';

COMMIT;
