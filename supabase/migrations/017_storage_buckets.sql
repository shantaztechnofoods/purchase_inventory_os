-- ─────────────────────────────────────────────────────────────────────────────
-- 017_storage_buckets.sql — provision the item-media Storage bucket
--
-- Item photos + design files are uploaded to Supabase Storage and only the public
-- URL is stored in items.photo / items.design_file. The DB row stays small; the
-- file payload doesn't ride realtime/PostgREST. This migration is idempotent — safe
-- to run multiple times.
--
-- Bucket policy: public READ (so <img src=…> and <a href=…> work straight from the
-- ERP UI without signed URLs), authenticated WRITE/DELETE (only ERP users can
-- upload/replace). Raise the 25 MB file_size_limit here if you need bigger drawings.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Bucket (id = name = "item-media", public-read, 25 MB cap)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('item-media', 'item-media', true, 26214400)        -- 25 MB
ON CONFLICT (id) DO UPDATE
  SET public          = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

-- 2) Object policies — re-asserted idempotently
DROP POLICY IF EXISTS "item_media_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "item_media_auth_upload"   ON storage.objects;
DROP POLICY IF EXISTS "item_media_auth_update"   ON storage.objects;
DROP POLICY IF EXISTS "item_media_auth_delete"   ON storage.objects;

CREATE POLICY "item_media_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'item-media');

CREATE POLICY "item_media_auth_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'item-media');

CREATE POLICY "item_media_auth_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'item-media')
  WITH CHECK (bucket_id = 'item-media');

CREATE POLICY "item_media_auth_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'item-media');

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'item-media') THEN
    RAISE EXCEPTION 'item-media bucket missing after migration';
  END IF;
  RAISE NOTICE 'item-media bucket + policies OK';
END
$verify$;
