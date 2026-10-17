-- ─────────────────────────────────────────────────────────────────────────────
-- 024_machine_attachments.sql — Phase B: department attachments
-- Depends on: 021 (machine_log columns), 017 pattern for storage policies.
--
-- IMPORTANT (manual step the owner must perform in the Supabase dashboard):
--   Create a Storage bucket named 'machine-attachments' with:
--     - Public: NO (private bucket)
--     - Allowed MIME types: image/*, video/*, application/pdf
--     - File size limit: 50 MB
--   The policies below assume this bucket exists.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.machine_attachments (
  id             bigserial    PRIMARY KEY,
  machine_id     bigint       NOT NULL REFERENCES public.machine_log(id) ON DELETE CASCADE,
  department     text         NOT NULL,
  stage          text,                                -- usually = department; kept for Phase C reports
  kind           text         NOT NULL CHECK (kind IN ('photo','video','document','trial_report')),
  storage_path   text         NOT NULL,              -- e.g. 'machine-attachments/<machine_id>/<id>.jpg'
  file_name      text,
  file_size      bigint,
  mime_type      text,
  caption        text,
  is_customer_visible boolean NOT NULL DEFAULT false, -- Phase C: controls customer report visibility
  uploaded_by    uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS machine_attachments_machine_idx
  ON public.machine_attachments (machine_id, department);
CREATE INDEX IF NOT EXISTS machine_attachments_customer_idx
  ON public.machine_attachments (machine_id)
  WHERE is_customer_visible = true;

ALTER TABLE public.machine_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS machine_attachments_select ON public.machine_attachments;
CREATE POLICY machine_attachments_select ON public.machine_attachments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS machine_attachments_insert ON public.machine_attachments;
CREATE POLICY machine_attachments_insert ON public.machine_attachments
  FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid()
              AND public.has_permission('machines','finishTransfer'));

DROP POLICY IF EXISTS machine_attachments_update ON public.machine_attachments;
CREATE POLICY machine_attachments_update ON public.machine_attachments
  FOR UPDATE TO authenticated
  USING (public.has_permission('machines','configDept'))
  WITH CHECK (public.has_permission('machines','configDept'));

DROP POLICY IF EXISTS machine_attachments_delete ON public.machine_attachments;
CREATE POLICY machine_attachments_delete ON public.machine_attachments
  FOR DELETE TO authenticated
  USING (public.has_permission('machines','configDept'));

-- ─── Storage bucket policies (same pattern as 017_storage_buckets) ─────────
-- Assume bucket 'machine-attachments' exists. If not, the policies attach
-- harmlessly (storage.objects already has RLS; no bucket means no rows).

DROP POLICY IF EXISTS "machine_attachments_auth_read"   ON storage.objects;
CREATE POLICY "machine_attachments_auth_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'machine-attachments');

DROP POLICY IF EXISTS "machine_attachments_auth_upload" ON storage.objects;
CREATE POLICY "machine_attachments_auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'machine-attachments'
              AND public.has_permission('machines','finishTransfer'));

DROP POLICY IF EXISTS "machine_attachments_auth_delete" ON storage.objects;
CREATE POLICY "machine_attachments_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'machine-attachments'
         AND public.has_permission('machines','configDept'));

COMMIT;
