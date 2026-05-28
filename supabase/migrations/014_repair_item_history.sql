-- ─────────────────────────────────────────────────────────────────────────────
-- 014_repair_item_history.sql — non-destructive repair of public.item_history
--
-- PROBLEM (production): record_stock_movement() inserts the full audit-trail schema
-- (item_name, category, event_type, quantity_change, stock_before, stock_after,
-- reference_number, notes, created_by, created_by_name). On a database where only the
-- legacy migration 002 ran (columns: event_date, event, change, qty_after) the RPC's
-- INSERT fails with:  column "item_name" of relation "item_history" does not exist
-- → every stock add/remove rolls back.
--
-- WHY NOT migration 008: 008 does DROP TABLE item_history CASCADE — that would delete
-- any history already written in production. This migration is ADDITIVE and IDEMPOTENT:
--   • adds every engine column if missing  (fixes legacy-002 tables)
--   • backfills new columns from legacy values so existing rows aren't blank
--   • relaxes legacy NOT NULL columns so the RPC (which omits them) can insert
--   • re-asserts RLS + indexes
-- Safe to run on ANY current state (legacy-002, partial, or full-008) and safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 0) Make sure the table exists at all (full schema). No-op if it already exists.
CREATE TABLE IF NOT EXISTS public.item_history (
  id                bigserial    PRIMARY KEY,
  item_id           uuid,
  item_code         text,
  item_name         text,
  category          text,
  event_type        text,
  quantity_change   numeric,
  stock_before      numeric,
  stock_after       numeric,
  reference_number  text,
  notes             text,
  created_by        uuid,
  created_by_name   text,
  created_at        timestamptz  NOT NULL DEFAULT now()
);

-- 1) Ensure every engine-expected column exists (covers legacy-002 tables).
ALTER TABLE public.item_history ADD COLUMN IF NOT EXISTS item_id          uuid;
ALTER TABLE public.item_history ADD COLUMN IF NOT EXISTS item_code        text;
ALTER TABLE public.item_history ADD COLUMN IF NOT EXISTS item_name        text;
ALTER TABLE public.item_history ADD COLUMN IF NOT EXISTS category         text;
ALTER TABLE public.item_history ADD COLUMN IF NOT EXISTS event_type       text;
ALTER TABLE public.item_history ADD COLUMN IF NOT EXISTS quantity_change  numeric;
ALTER TABLE public.item_history ADD COLUMN IF NOT EXISTS stock_before     numeric;
ALTER TABLE public.item_history ADD COLUMN IF NOT EXISTS stock_after      numeric;
ALTER TABLE public.item_history ADD COLUMN IF NOT EXISTS reference_number text;
ALTER TABLE public.item_history ADD COLUMN IF NOT EXISTS notes            text;
ALTER TABLE public.item_history ADD COLUMN IF NOT EXISTS created_by       uuid;
ALTER TABLE public.item_history ADD COLUMN IF NOT EXISTS created_by_name  text;
ALTER TABLE public.item_history ADD COLUMN IF NOT EXISTS created_at       timestamptz NOT NULL DEFAULT now();

-- 2) Reconcile legacy columns: backfill new columns from them, then drop their NOT NULL
--    so the RPC's INSERT (which does not provide them) succeeds. Each guarded so the
--    statement is skipped cleanly when the legacy column isn't present.
DO $repair$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='item_history' AND column_name='event') THEN
    EXECUTE 'UPDATE public.item_history SET event_type = COALESCE(event_type, event) WHERE event_type IS NULL';
    EXECUTE 'ALTER TABLE public.item_history ALTER COLUMN event DROP NOT NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='item_history' AND column_name='change') THEN
    EXECUTE 'UPDATE public.item_history SET quantity_change = COALESCE(quantity_change, change) WHERE quantity_change IS NULL';
    EXECUTE 'ALTER TABLE public.item_history ALTER COLUMN change DROP NOT NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='item_history' AND column_name='qty_after') THEN
    EXECUTE 'UPDATE public.item_history SET stock_after = COALESCE(stock_after, qty_after) WHERE stock_after IS NULL';
    EXECUTE 'ALTER TABLE public.item_history ALTER COLUMN qty_after DROP NOT NULL';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='item_history' AND column_name='event_date') THEN
    EXECUTE 'ALTER TABLE public.item_history ALTER COLUMN event_date DROP NOT NULL';
  END IF;
END
$repair$;

-- 3) Re-assert append-only RLS (read + insert for active users; no UPDATE/DELETE policies).
ALTER TABLE public.item_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS item_history_select ON public.item_history;
DROP POLICY IF EXISTS item_history_insert ON public.item_history;
CREATE POLICY item_history_select ON public.item_history FOR SELECT USING (public.is_active_user());
CREATE POLICY item_history_insert ON public.item_history FOR INSERT WITH CHECK (public.is_active_user());

-- 4) Indexes (idempotent).
CREATE INDEX IF NOT EXISTS item_history_item_idx    ON public.item_history(item_id);
CREATE INDEX IF NOT EXISTS item_history_code_idx    ON public.item_history(item_code);
CREATE INDEX IF NOT EXISTS item_history_created_idx ON public.item_history(created_at DESC);
CREATE INDEX IF NOT EXISTS item_history_event_idx   ON public.item_history(event_type);
CREATE INDEX IF NOT EXISTS item_history_ref_idx     ON public.item_history(reference_number);

-- 5) Self-verify: fail loudly if the column the RPC needs is still missing.
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='item_history' AND column_name='item_name') THEN
    RAISE EXCEPTION 'REPAIR FAILED: item_history.item_name still missing';
  END IF;
  RAISE NOTICE 'item_history repair OK — all engine columns present.';
END
$verify$;

COMMENT ON TABLE public.item_history IS
  'Append-only inventory audit trail. Repaired by 014 to the full engine schema (additive, non-destructive).';
