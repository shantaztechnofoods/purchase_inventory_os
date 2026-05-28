-- ─────────────────────────────────────────────────────────────────────────────
-- 010_fix_audit_user_fk.sql — drop audit_log.user_id FK to unblock user deletion
--
-- ROOT CAUSE FIXED:
--   public.audit_log.user_id had FK → public.users(id) ON DELETE SET NULL.
--   The reject_audit_change() trigger (from 004) raises EXCEPTION on any UPDATE.
--   When Postgres tries to DELETE a user, it attempts the cascade SET NULL on
--   referencing audit_log rows. The trigger blocks the UPDATE.
--   Result: user deletion fails with 23514 "audit_log is immutable: UPDATE is not allowed".
--
-- WHY DROPPING THE FK IS THE CORRECT FIX (not a workaround):
--   • Audit log is APPEND-ONLY and IMMUTABLE by design (per spec).
--   • Historical accuracy demands that "user X did action Y at time Z" remain
--     true forever — the user_id must NOT be altered even after the user is deleted.
--   • We already denormalize user_name + user_role at INSERT time precisely to
--     keep the audit row legible after the user disappears.
--   • A FK constraint with SET NULL is incompatible with immutability — by
--     definition it MUTATES historical rows.
--   • Without the FK, the user_id column is a "soft pointer": it points at a
--     historical UUID. If the user still exists, joins work. If they don't,
--     the denormalized user_name field tells you who they were.
--
-- WHAT CHANGES:
--   • audit_log.user_id is no longer a FK — the column itself stays (still uuid).
--   • All existing rows keep their current user_id values unchanged.
--   • New rows can still INSERT any uuid (referential integrity is enforced at
--     the application layer when writing audit rows — we always pass auth.uid()
--     or null, which is always valid).
--   • Other FKs to public.users(id) (item_history, items, bom_definitions, etc.)
--     are unaffected — they don't have immutability triggers, so SET NULL works.
--
-- IDEMPOTENT — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the constraint if it exists. Use IF EXISTS for idempotency.
-- The constraint name is the auto-generated default; we drop by name AND
-- fall back to a dynamic lookup in case the name differs in some environments.
DO $migration$
DECLARE
  v_constraint_name text;
BEGIN
  -- Find the FK by constraint type + column, regardless of name
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class       rel ON rel.oid = con.conrelid
  JOIN pg_namespace   nsp ON nsp.oid = rel.relnamespace
  JOIN pg_attribute   att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'audit_log'
    AND con.contype = 'f'
    AND att.attname = 'user_id'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.audit_log DROP CONSTRAINT %I', v_constraint_name);
    RAISE NOTICE 'Dropped FK constraint % from public.audit_log.user_id', v_constraint_name;
  ELSE
    RAISE NOTICE 'No FK constraint found on public.audit_log.user_id — nothing to drop';
  END IF;
END
$migration$;

-- Re-document the column's new semantics
COMMENT ON COLUMN public.audit_log.user_id IS
  'UUID of the user who performed the action AT THE TIME. NOT a foreign key — audit log is immutable and historical user_id values must survive user deletion. Use denormalized user_name and user_role columns when the referenced user no longer exists.';

-- Verification query (informational — not enforced)
DO $verify$
DECLARE
  v_fk_count int;
BEGIN
  SELECT count(*) INTO v_fk_count
  FROM pg_constraint con
  JOIN pg_class       rel ON rel.oid = con.conrelid
  JOIN pg_namespace   nsp ON nsp.oid = rel.relnamespace
  JOIN pg_attribute   att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'audit_log'
    AND con.contype = 'f'
    AND att.attname = 'user_id';

  IF v_fk_count = 0 THEN
    RAISE NOTICE 'VERIFIED: public.audit_log.user_id has 0 foreign-key constraints. User deletion is now unblocked.';
  ELSE
    RAISE EXCEPTION 'MIGRATION FAILED: % FK constraints still exist on public.audit_log.user_id', v_fk_count;
  END IF;
END
$verify$;
