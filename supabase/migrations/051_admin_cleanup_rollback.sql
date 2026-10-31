-- Reverses 051. Audit rows written by cleanups are kept (audit_log is immutable).
BEGIN;
DROP FUNCTION IF EXISTS public.admin_cleanup_machines(bigint[], boolean, bigint[]);
COMMIT;
