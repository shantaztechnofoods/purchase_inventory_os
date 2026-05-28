-- ─────────────────────────────────────────────────────────────────────────────
-- 008_history_and_softdelete.sql
-- Phase 1 fix: recreate item_history with the full audit-trail schema and
-- convert items to soft-delete so history survives deactivation.
--
-- SAFE: item_history is reported empty. DROP+CREATE preserves no data loss.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.item_history CASCADE;

CREATE TABLE public.item_history (
  id                bigserial    PRIMARY KEY,
  item_id           uuid         REFERENCES public.items(id) ON DELETE SET NULL,  -- SET NULL so history survives item delete
  item_code         text,                                                          -- denormalized: survives item delete
  item_name         text,                                                          -- denormalized
  category          text,                                                          -- denormalized
  event_type        text         NOT NULL,                                         -- 'Opening','Restock','Usage','PO Receive','BOM Issue','Correction','Reversal',...
  quantity_change   numeric      NOT NULL,                                         -- signed delta (+received, −issued)
  stock_before      numeric,
  stock_after       numeric,
  reference_number  text,                                                          -- PO-123, BOM key, issueId, etc.
  notes             text,
  created_by        uuid         REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name   text,                                                          -- denormalized: survives user delete
  created_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX item_history_item_idx    ON public.item_history(item_id);
CREATE INDEX item_history_code_idx    ON public.item_history(item_code);
CREATE INDEX item_history_created_idx ON public.item_history(created_at DESC);
CREATE INDEX item_history_event_idx   ON public.item_history(event_type);
CREATE INDEX item_history_ref_idx     ON public.item_history(reference_number);

-- Append-only RLS: any active user can read or insert; no UPDATE/DELETE policies.
ALTER TABLE public.item_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY item_history_select ON public.item_history FOR SELECT USING (public.is_active_user());
CREATE POLICY item_history_insert ON public.item_history FOR INSERT WITH CHECK (public.is_active_user());

-- ── Soft delete on items ────────────────────────────────────────────────────
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS is_active       boolean     NOT NULL DEFAULT true;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS deactivated_at  timestamptz;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS deactivated_by  uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS items_is_active_idx ON public.items(is_active);

COMMENT ON TABLE  public.item_history IS 'Append-only inventory audit trail. Survives item soft-delete and user deletion via denormalized columns.';
COMMENT ON COLUMN public.items.is_active IS 'false = soft-deleted (deactivated). Default fetchItems() filters to is_active=true.';
