-- 024_machine_attachments_rollback.sql
-- Note: does NOT delete objects in the storage bucket. Operator must empty
-- the 'machine-attachments' bucket manually before re-running.
BEGIN;
DROP POLICY IF EXISTS "machine_attachments_auth_read"   ON storage.objects;
DROP POLICY IF EXISTS "machine_attachments_auth_upload" ON storage.objects;
DROP POLICY IF EXISTS "machine_attachments_auth_delete" ON storage.objects;
DROP TABLE IF EXISTS public.machine_attachments;
COMMIT;
