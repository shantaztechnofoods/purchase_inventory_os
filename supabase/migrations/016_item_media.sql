-- ─────────────────────────────────────────────────────────────────────────────
-- 016_item_media.sql — optional photo + design file per item
--
-- Adds three nullable columns to public.items so an item can carry a photo and a
-- design/drawing attachment. The actual file lives in Supabase Storage (bucket
-- "item-media", provisioned by migration 017). These columns hold only the public
-- URL (or, in offline dev mode, a small data URL). Additive + idempotent.
--
-- itemsStore.createItem / updateItem are schema-tolerant — items still create/
-- update if this migration hasn't been run yet (the media columns are then
-- stripped from the payload and persistence simply doesn't happen).
--
-- These columns are pure METADATA. They do NOT participate in stock calculations,
-- the engine RPC, or any inventory math. Default NULL = no media.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.items ADD COLUMN IF NOT EXISTS photo       text;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS design_file text;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS design_name text;

COMMENT ON COLUMN public.items.photo       IS 'Item photo — public URL in item-media bucket (preferred) or small data URL.';
COMMENT ON COLUMN public.items.design_file IS 'Item design/drawing (PNG/JPG/PDF) — public URL in item-media bucket (preferred) or small data URL.';
COMMENT ON COLUMN public.items.design_name IS 'Original filename of design_file (shown to operators).';
