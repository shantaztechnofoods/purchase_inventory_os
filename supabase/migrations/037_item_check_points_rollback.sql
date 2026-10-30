-- Rollback for 037 — Per-item check points
--
-- Drops the template column. BOM lines keep their inherited copies inside
-- bom_definitions.items (jsonb), so existing BOMs and the Outward check-point
-- popup keep working; only the per-item template is lost.

ALTER TABLE public.items
  DROP COLUMN IF EXISTS check_points;
