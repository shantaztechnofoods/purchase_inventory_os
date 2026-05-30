-- ─────────────────────────────────────────────────────────────────────────────
-- 016_item_media.sql — optional photo + design file per item
--
-- Adds three nullable columns to public.items so an item can carry a photo and a
-- design/drawing attachment (stored as a data URL or external URL). Additive +
-- idempotent. The app (itemsStore.createItem / updateItem) is schema-tolerant and
-- still creates/updates items if this migration hasn't been run yet — running it
-- simply makes the photo/design choice persist.
--
-- These columns are pure METADATA. They do NOT participate in stock calculations,
-- the engine RPC, or any inventory math. Default NULL = no media.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS photo       text;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS design_file text;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS design_name text;

COMMENT ON COLUMN public.items.photo       IS 'Item photo as a data URL (preferred for small images) or external URL.';
COMMENT ON COLUMN public.items.design_file IS 'Item design/drawing file (PNG/JPG/PDF) as a data URL or external URL.';
COMMENT ON COLUMN public.items.design_name IS 'Original filename of design_file (shown to operators).';
