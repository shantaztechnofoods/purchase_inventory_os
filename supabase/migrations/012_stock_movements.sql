-- ─────────────────────────────────────────────────────────────────────────────
-- 012_stock_movements.sql — immutable stock movement ledger
--
-- Design lessons applied from the audit_log FK deadlock (migration 010):
--   • item_id and created_by are SOFT POINTERS (plain uuid, NO foreign key).
--     An immutable table with FK ON DELETE SET NULL deadlocks deletion because
--     the SET NULL is an UPDATE the immutability trigger rejects. We avoid that
--     entirely by not having the FK. Denormalized item_code/item_name/created_by_name
--     preserve identity forever.
--   • Immutability enforced by trigger (no UPDATE/DELETE for anyone, ever).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id              bigserial    PRIMARY KEY,
  item_id         uuid,                                          -- soft pointer (no FK)
  item_code       text         NOT NULL,                         -- denormalized
  item_name       text,
  movement_type   text         NOT NULL CHECK (movement_type IN (
                    'purchase_in','production_issue','production_output',
                    'manual_adjustment','sales_out','return_in','return_out')),
  qty             numeric      NOT NULL,                          -- SIGNED delta (+in / −out)
  before_stock    numeric      NOT NULL,
  after_stock     numeric      NOT NULL,
  reference_type  text,                                          -- 'purchase_order','bom','correction',...
  reference_id    text,                                          -- PO id, bom key, issue id, etc.
  notes           text,
  created_by      uuid,                                          -- soft pointer (no FK)
  created_by_name text,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_movements_item_idx    ON public.stock_movements(item_id);
CREATE INDEX IF NOT EXISTS stock_movements_code_idx    ON public.stock_movements(item_code);
CREATE INDEX IF NOT EXISTS stock_movements_type_idx    ON public.stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS stock_movements_created_idx ON public.stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_ref_idx     ON public.stock_movements(reference_type, reference_id);

-- ── RLS: read + insert for active users; no UPDATE/DELETE policies (deny) ────
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_movements_select ON public.stock_movements;
DROP POLICY IF EXISTS stock_movements_insert ON public.stock_movements;
CREATE POLICY stock_movements_select ON public.stock_movements FOR SELECT USING (public.is_active_user());
CREATE POLICY stock_movements_insert ON public.stock_movements FOR INSERT WITH CHECK (public.is_active_user());

-- ── Generic immutability trigger function (reusable, table-aware message) ────
CREATE OR REPLACE FUNCTION public.reject_immutable_change() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION '% is immutable: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END
$fn$;

DROP TRIGGER IF EXISTS stock_movements_no_update ON public.stock_movements;
DROP TRIGGER IF EXISTS stock_movements_no_delete ON public.stock_movements;
CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();
CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.reject_immutable_change();

COMMENT ON TABLE public.stock_movements IS
  'Immutable stock ledger. Every stock change is one row. item_id/created_by are soft pointers (no FK) so the immutable table never deadlocks deletion.';
